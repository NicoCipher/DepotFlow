-- M2f-21: stage new-depot atomic drink stock receiving.
-- Converts EXACT owned empty crates to sellable drink bottles and stores a
-- permanent per-business request audit + normal stock activity/receipt.
-- Default OFF, no authenticated/anon EXECUTE. No new-business checkout.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_receiving_gate (
  singleton boolean primary key default true check(singleton is true),
  enabled boolean not null default false
);
insert into private.business_receiving_gate(singleton,enabled)
values(true,false);
alter table private.business_receiving_gate enable row level security;
revoke all on private.business_receiving_gate from
  public,anon,authenticated,service_role;

create table private.business_receiving_requests (
  business_id uuid not null references private.businesses(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null,
  crate_type_id uuid not null,
  crates integer not null check(crates>0),
  bottles_per_crate integer not null check(bottles_per_crate>0),
  expected_stock integer not null check(expected_stock>=0),
  expected_empties integer not null check(expected_empties>=0),
  stock_after integer not null check(stock_after>=0),
  empties_after integer not null check(empties_after>=0),
  business_date date not null,
  created_at timestamptz not null default now(),
  primary key (business_id,request_id),
  foreign key (business_id,product_id)
    references public.products(business_id,id) on delete restrict,
  foreign key (business_id,crate_type_id)
    references public.crate_types(business_id,id) on delete restrict
);
alter table private.business_receiving_requests enable row level security;
revoke all on private.business_receiving_requests from
  public,anon,authenticated,service_role;

-- Extend the already-reviewed operation trigger. Only owned CREATE/UPDATE
-- of physical crate stock, product stock, receipt and movement rows may
-- pass the separate receiving gate; all other operations stay legacy-only.
do $extend_business_receiving_trigger$
declare
  v_oid oid:='private.scope_legacy_operational_write()'::regprocedure;
  v_source text;
  v_old_when constant text :=
    'if tg_table_schema=''public'' and tg_table_name in '
      || '(''empty_bottle_stock'',''empty_crate_stock'',''stock'')';
  v_new_when constant text :=
    'if ((tg_table_schema=''public'' and tg_table_name in '
      || '(''empty_bottle_stock'',''empty_crate_stock'',''stock'',''stock_movements''))'
      || ' or (tg_table_schema=''private'' and tg_table_name=''stock_receipts''))';
  v_old_crate_gate constant text :=
    'tg_table_name=''empty_crate_stock'' and not exists ('
    || E'\n      select 1 from private.business_crate_count_gate where enabled is true\n'
    || '    ) then';
  v_new_crate_gate constant text :=
    'tg_table_name=''empty_crate_stock'' and not exists ('
    || E'\n      select 1 from private.business_crate_count_gate where enabled is true\n'
    || E'    ) and not exists (\n'
    || E'      select 1 from private.business_receiving_gate where enabled is true\n'
    || '    ) then';
  v_old_stock_gate constant text :=
    'tg_table_name=''stock'' and not exists ('
    || E'\n      select 1 from private.business_product_stock_count_gate where enabled is true\n'
    || '    ) then';
  v_new_stock_gate constant text :=
    'tg_table_name=''stock'' and not exists ('
    || E'\n      select 1 from private.business_product_stock_count_gate where enabled is true\n'
    || E'    ) and not exists (\n'
    || E'      select 1 from private.business_receiving_gate where enabled is true\n'
    || '    ) then';
  v_old_tail constant text :=
    E'      raise exception \'Business drink stock counting is not available\'\n'
      || E'        using errcode=\'42501\';\n'
      || '    end if;';
  v_new_tail constant text :=
    E'      raise exception \'Business drink stock counting is not available\'\n'
      || E'        using errcode=\'42501\';\n'
      || E'    elsif tg_table_name in (\'stock_movements\',\'stock_receipts\')\n'
      || E'      and not exists (\n'
      || E'        select 1 from private.business_receiving_gate where enabled is true\n'
      || E'      ) then\n'
      || E'      raise exception \'Business stock receiving is not available\'\n'
      || E'        using errcode=\'42501\';\n'
      || '    end if;';
  v_hits int;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
     or pg_catalog.strpos(v_source,'private.business_product_stock_count_gate')=0
     or pg_catalog.strpos(v_source,'private.business_receiving_gate')<>0 then
    raise exception 'Receiving trigger prerequisite drift';
  end if;
  v_hits:=(length(v_source)-length(replace(v_source,v_old_when,'')))
    /length(v_old_when);
  if v_hits<>1 then raise exception 'Missing exact scoped stock trigger: %',v_hits;end if;
  v_source:=replace(v_source,v_old_when,v_new_when);
  v_hits:=(length(v_source)-length(replace(v_source,v_old_crate_gate,'')))
    /length(v_old_crate_gate);
  if v_hits<>1 then raise exception 'Missing exact crate count gate: %',v_hits;end if;
  v_source:=replace(v_source,v_old_crate_gate,v_new_crate_gate);
  v_hits:=(length(v_source)-length(replace(v_source,v_old_stock_gate,'')))
    /length(v_old_stock_gate);
  if v_hits<>1 then raise exception 'Missing exact product count gate: %',v_hits;end if;
  v_source:=replace(v_source,v_old_stock_gate,v_new_stock_gate);
  v_hits:=(length(v_source)-length(replace(v_source,v_old_tail,'')))
    /length(v_old_tail);
  if v_hits<>1 then raise exception 'Missing exact gate tail: %',v_hits;end if;
  v_source:=replace(v_source,v_old_tail,v_new_tail);
  execute v_source;
end;
$extend_business_receiving_trigger$;

create function public.receive_business_stock(
  p_business_id uuid,
  p_request_id uuid,
  p_product_id uuid,
  p_crates numeric,
  p_expected_stock integer,
  p_expected_empties integer,
  p_expected_bottles_per_crate integer,
  p_expected_crate_type_id uuid,
  p_business_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $receive$
declare
  v_actor uuid;
  v_product public.products%rowtype;
  v_crate public.crate_types%rowtype;
  v_prior private.business_receiving_requests%rowtype;
  v_stock integer;
  v_empties integer;
  v_added numeric;
  v_movement uuid;
  v_receipt uuid;
begin
  v_actor:=auth.uid();
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is null and b.status='active'
    for share of m,b;
  if not found then
    raise exception 'Business not available' using errcode='42501';
  end if;
  -- Explicit release gates stay locked for the entire financial/stock write.
  perform 1 from private.business_receiving_gate g
    where g.enabled is true for share;
  if not found or not exists(
    select 1 from private.legacy_write_scope_gate where enabled is true
  ) then
    raise exception 'Business stock receiving is not available'
      using errcode='42501';
  end if;

  if p_request_id is null or p_product_id is null or p_business_date is null
     or p_expected_crate_type_id is null
     or p_crates is null or p_crates='NaN'::numeric
     or p_crates<=0 or p_crates>2147483647
     or p_crates<>pg_catalog.trunc(p_crates)
     or p_expected_stock is null or p_expected_stock<0
     or p_expected_empties is null or p_expected_empties<0
     or p_expected_bottles_per_crate is null or p_expected_bottles_per_crate<=0 then
    raise exception 'Enter a valid number of whole crates and stock values'
      using errcode='22023';
  end if;

  -- The original product and crate UUIDs must belong to the selected
  -- business; never accept physical types merely because pockets match.
  select * into v_product from public.products
   where id=p_product_id and business_id=p_business_id and is_active is true
   for share;
  if not found then
    raise exception 'Drink is no longer available' using errcode='22023';
  end if;
  select * into v_crate from public.crate_types
    where id=v_product.crate_type_id and business_id=p_business_id for share;
  if not found
    or p_expected_bottles_per_crate<>v_product.bottles_per_crate
    or p_expected_crate_type_id<>v_product.crate_type_id
    or (v_crate.pocket_count is not null
        and v_crate.pocket_count<>v_product.bottles_per_crate) then
    raise exception 'Drink or exact crate details changed. Review again.'
      using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text||':'||p_request_id::text,0)
  );

  select * into v_prior from private.business_receiving_requests
   where business_id=p_business_id and request_id=p_request_id for update;
  if found then
    if v_prior.product_id<>p_product_id
       or v_prior.crate_type_id<>p_expected_crate_type_id
       or v_prior.crates<>p_crates
       or v_prior.expected_stock<>p_expected_stock
       or v_prior.expected_empties<>p_expected_empties
       or v_prior.bottles_per_crate<>p_expected_bottles_per_crate
       or v_prior.business_date<>p_business_date then
      raise exception 'This receiving request was already used'
        using errcode='22023';
    end if;
    return jsonb_build_object(
      'requestId',p_request_id,'businessId',p_business_id,
      'stock_after',v_prior.stock_after,
      'empties_after',v_prior.empties_after);
  end if;

  -- A stock COUNT and a RECEIVE with one UUID are not the same operation.
  if exists (
    select 1 from private.business_product_stock_counts
    where business_id=p_business_id and request_id=p_request_id
  ) then
    raise exception 'This request ID was already used for a stock count'
      using errcode='22023';
  end if;

  -- Current crate inventory must be locked before product stock, matching
  -- the verified original shop's stock-receiving lock order.
  select quantity into v_empties from public.empty_crate_stock
    where business_id=p_business_id and crate_type_id=v_product.crate_type_id
    for update;
  if not found or v_empties<p_crates then
    raise exception 'Not enough empty crates of this exact type'
      using errcode='22023';
  end if;
  select total_bottles into v_stock from public.stock
    where business_id=p_business_id and product_id=p_product_id for update;
  v_stock:=coalesce(v_stock,0);
  if v_stock<>p_expected_stock or v_empties<>p_expected_empties then
    raise exception 'Stock or empty crate counts changed. Review again.'
      using errcode='22023';
  end if;
  v_added:=p_crates*v_product.bottles_per_crate;
  if v_added+v_stock>2147483647 then
    raise exception 'That would exceed the stock limit'
      using errcode='22023';
  end if;

  update public.empty_crate_stock
    set quantity=quantity-p_crates::integer
    where business_id=p_business_id and crate_type_id=v_product.crate_type_id
      and quantity>=p_crates
    returning quantity into v_empties;
  if not found then
    raise exception 'Empty crate stock changed. Review again.'
      using errcode='22023';
  end if;

  insert into public.stock(product_id,business_id,total_bottles)
    values(p_product_id,p_business_id,(v_stock+v_added)::integer)
    on conflict(product_id) do update
      set total_bottles=excluded.total_bottles
      where public.stock.business_id=p_business_id
        and public.stock.total_bottles=p_expected_stock
    returning total_bottles into v_stock;
  if not found then
    raise exception 'Product stock changed. Review again.'
      using errcode='22023';
  end if;

  insert into private.stock_receipts(
    business_id,request_id,product_id,crates,stock_after,empties_after,
    business_date,crate_type_id
  ) values (
    p_business_id,p_request_id,p_product_id,p_crates::integer,
    v_stock,v_empties,p_business_date,v_product.crate_type_id
  ) returning receipt_id into v_receipt;
  insert into public.stock_movements(
    business_id,product_id,movement_type,quantity_change,resulting_stock,
    business_date,request_id,crates,loose_bottles,bottles_per_crate,
    product_name,crate_type_id
  ) values (
    p_business_id,p_product_id,'receive',v_added::integer,v_stock,
    p_business_date,p_request_id,p_crates::integer,0,
    v_product.bottles_per_crate,
    pg_catalog.concat_ws(' ',v_product.name,v_product.size),
    v_product.crate_type_id
  ) returning id into v_movement;

  insert into private.business_receiving_requests(
    business_id,request_id,actor_id,product_id,crate_type_id,crates,
    bottles_per_crate,expected_stock,expected_empties,stock_after,
    empties_after,business_date
  ) values (
    p_business_id,p_request_id,v_actor,p_product_id,v_product.crate_type_id,
    p_crates::integer,v_product.bottles_per_crate,p_expected_stock,
    p_expected_empties,v_stock,v_empties,p_business_date
  );

  return jsonb_build_object(
    'requestId',p_request_id,'businessId',p_business_id,
    'stock_after',v_stock,'empties_after',v_empties);
end;
$receive$;

-- The RPC cannot be used from the app; activation requires an independent
-- grant review + gate and actual multi-depot staging verification.
revoke all on function public.receive_business_stock(
 uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date
) from public,anon,authenticated,service_role;

commit;
