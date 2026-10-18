-- M2f-19: stage an owner-scoped physical drink stock count for a future depot.
-- Business-specific product identity, immutable audit and retry protection.
-- Deliberately default OFF and no authenticated EXECUTE grant. This is NOT
-- stock receiving or a substitute for a complete stock-movement event ledger.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $stock_count_preflight$
declare
  v_key text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_key
  from pg_catalog.pg_constraint
  where conrelid='public.stock'::regclass and contype='p';
  if v_key is distinct from 'PRIMARY KEY (product_id)' then
    raise exception 'Expected global product UUID stock key, got %',v_key;
  end if;
  if not exists(
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.stock'::regclass and c.contype='f'
      and c.confrelid='public.products'::regclass
      and c.conname like 'tenant_%'
  ) then
    raise exception 'Business-qualified stock/product foreign key missing';
  end if;
end;
$stock_count_preflight$;

create table private.business_product_stock_count_gate (
  singleton boolean primary key default true check (singleton is true),
  enabled boolean not null default false
);
insert into private.business_product_stock_count_gate(singleton,enabled)
values(true,false);
alter table private.business_product_stock_count_gate enable row level security;
revoke all on private.business_product_stock_count_gate
  from public,anon,authenticated,service_role;

create table private.business_product_stock_counts (
  business_id uuid not null references private.businesses(id) on delete restrict,
  request_id uuid not null,
  product_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  crates integer not null check (crates>=0),
  loose_bottles integer not null check (loose_bottles>=0),
  bottles_per_crate integer not null check (bottles_per_crate>0),
  expected_total integer not null check (expected_total>=0),
  previous_total integer not null check (previous_total>=0),
  new_total integer not null check (new_total>=0),
  business_date date not null,
  created_at timestamptz not null default now(),
  primary key (business_id,request_id),
  foreign key (business_id,product_id)
    references public.products(business_id,id) on delete restrict
);
alter table private.business_product_stock_counts enable row level security;
revoke all on private.business_product_stock_counts
  from public,anon,authenticated,service_role;

-- Existing trigger handles new-shop stock rows ONLY when the separate,
-- disabled administrative gate is enabled. No other table gains permissions.
do $extend_stock_count_scope$
declare
  v_oid oid := 'private.scope_legacy_operational_write()'::regprocedure;
  v_source text;
  v_old_when constant text :=
    'tg_table_name in (''empty_bottle_stock'',''empty_crate_stock'')';
  v_new_when constant text :=
    'tg_table_name in (''empty_bottle_stock'',''empty_crate_stock'',''stock'')';
  v_old_gate constant text := $oldgate$
    elsif tg_table_name='empty_crate_stock' and not exists (
      select 1 from private.business_crate_count_gate where enabled is true
    ) then
      raise exception 'Business empty-crate counting is not available'
        using errcode='42501';
    end if;$oldgate$;
  v_new_gate constant text := $newgate$
    elsif tg_table_name='empty_crate_stock' and not exists (
      select 1 from private.business_crate_count_gate where enabled is true
    ) then
      raise exception 'Business empty-crate counting is not available'
        using errcode='42501';
    elsif tg_table_name='stock' and not exists (
      select 1 from private.business_product_stock_count_gate where enabled is true
    ) then
      raise exception 'Business drink stock counting is not available'
        using errcode='42501';
    end if;$newgate$;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
     or (length(v_source)-length(replace(v_source,v_old_when,'')))
        /length(v_old_when)<>1
     or (length(v_source)-length(replace(v_source,v_old_gate,'')))
        /length(v_old_gate)<>1
     or pg_catalog.strpos(v_source,'private.business_product_stock_count_gate')<>0 then
    raise exception 'Stock scope trigger changed; manual approval required';
  end if;
  v_source:=replace(v_source,v_old_when,v_new_when);
  v_source:=replace(v_source,v_old_gate,v_new_gate);
  execute v_source;
end;
$extend_stock_count_scope$;

create function public.count_business_product_stock(
  p_business_id uuid,
  p_request_id uuid,
  p_product_id uuid,
  p_crates numeric,
  p_loose_bottles numeric,
  p_expected_total integer,
  p_expected_bottles_per_crate integer,
  p_business_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $count$
declare
  v_actor uuid;
  v_product public.products%rowtype;
  v_current integer;
  v_new_total numeric;
  v_written uuid;
  v_event private.business_product_stock_counts%rowtype;
begin
  v_actor:=auth.uid();
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;

  -- Authorization must precede any product, request-ID or stock lookup.
  -- Holding the authorization row lock prevents race with owner revocation.
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is null and b.status in ('setup','active')
    for share of m,b;
  if not found then
    raise exception 'Business not available' using errcode='42501';
  end if;
  if not exists(
    select 1 from private.legacy_write_scope_gate where enabled is true
  ) or not exists(
    select 1 from private.business_product_stock_count_gate where enabled is true
  ) then
    raise exception 'Business drink stock counting is not available'
      using errcode='42501';
  end if;
  if p_request_id is null or p_product_id is null
     or p_business_date is null
     or p_crates is null or p_crates='NaN'::numeric or p_crates<0
     or p_loose_bottles is null or p_loose_bottles='NaN'::numeric
     or p_loose_bottles<0
     or p_crates<>pg_catalog.trunc(p_crates)
     or p_loose_bottles<>pg_catalog.trunc(p_loose_bottles)
     or p_crates>2147483647 or p_loose_bottles>2147483647
     or p_expected_total is null or p_expected_total<0
     or p_expected_bottles_per_crate is null or p_expected_bottles_per_crate<=0 then
    raise exception 'Enter valid whole crates and loose bottles'
      using errcode='22023';
  end if;

  -- Lock exact product metadata before deriving physical stock total.
  select * into v_product from public.products
    where id=p_product_id and business_id=p_business_id
    for share;
  if not found then
    raise exception 'Drink is no longer available'
      using errcode='22023';
  end if;
  if p_expected_bottles_per_crate<>v_product.bottles_per_crate
     or p_loose_bottles>=v_product.bottles_per_crate then
    raise exception 'Crate size or stock details changed. Review again.'
      using errcode='22023';
  end if;
  v_new_total:=p_crates*v_product.bottles_per_crate+p_loose_bottles;
  if v_new_total>2147483647 then
    raise exception 'That would exceed the stock limit'
      using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text||':'||p_request_id::text,0)
  );
  select * into v_event from private.business_product_stock_counts
    where business_id=p_business_id and request_id=p_request_id
    for update;
  if found then
    if v_event.product_id<>p_product_id
      or v_event.crates<>p_crates
      or v_event.loose_bottles<>p_loose_bottles
      or v_event.expected_total<>p_expected_total
      or v_event.bottles_per_crate<>p_expected_bottles_per_crate
      or v_event.business_date<>p_business_date then
      raise exception 'This stock count request was already used'
        using errcode='22023';
    end if;
    return jsonb_build_object(
      'requestId',p_request_id,'businessId',p_business_id,
      'productId',p_product_id,'previous',v_event.previous_total,
      'total',v_event.new_total);
  end if;

  select total_bottles into v_current from public.stock
    where product_id=p_product_id and business_id=p_business_id
    for update;
  v_current:=coalesce(v_current,0);
  if v_current<>p_expected_total then
    raise exception 'Drink stock changed. Refresh and check again.'
      using errcode='22023';
  end if;

  -- Atomic insert or conditional update, including concurrent first counts
  -- of a brand-new product whose stock row does not exist yet.
  insert into public.stock(product_id,business_id,total_bottles)
    values(p_product_id,p_business_id,v_new_total::integer)
    on conflict(product_id) do update
      set total_bottles=excluded.total_bottles
      where public.stock.business_id=p_business_id
        and public.stock.total_bottles=p_expected_total
    returning product_id into v_written;
  if v_written is null then
    raise exception 'Drink stock changed. Refresh and check again.'
      using errcode='22023';
  end if;

  insert into private.business_product_stock_counts(
    business_id,request_id,product_id,actor_id,crates,loose_bottles,
    bottles_per_crate,expected_total,previous_total,new_total,business_date
  ) values(
    p_business_id,p_request_id,p_product_id,v_actor,p_crates::integer,
    p_loose_bottles::integer,p_expected_bottles_per_crate,
    p_expected_total,v_current,v_new_total::integer,p_business_date
  );
  return jsonb_build_object(
    'requestId',p_request_id,'businessId',p_business_id,
    'productId',p_product_id,'previous',v_current,'total',v_new_total::integer);
end;
$count$;
revoke all on function public.count_business_product_stock(
  uuid,uuid,uuid,numeric,numeric,integer,integer,date
) from public,anon,authenticated,service_role;

commit;
