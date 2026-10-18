-- M2f-24: stage exact per-business crate + shared-catalogue assortment setup.
-- DRAFT ONLY. The rollout gate starts OFF and neither RPC is callable by
-- authenticated/anon. Does not provision businesses, create balances, or
-- authorize new-depot checkout. Migration-history NO-GO still applies.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_assortment_setup_gate (
  singleton boolean primary key default true check(singleton is true),
  enabled boolean not null default false
);
insert into private.business_assortment_setup_gate(singleton,enabled)
values(true,false);
alter table private.business_assortment_setup_gate enable row level security;
revoke all on private.business_assortment_setup_gate
  from public,anon,authenticated,service_role;

-- Existing RLS still prevents direct nonlegacy crate/product table DML.
-- Extend ONLY INSERT for an authenticated, active, verified nonlegacy owner
-- when a separately managed private gate is enabled. No UPDATE/DELETE,
-- legacy scope expansion, stock, payments or financial table changes.
do $extend_assortment_scope$
declare
  v_oid oid := 'private.scope_legacy_operational_write()'::regprocedure;
  v_source text;
  v_anchor constant text :=
    E'\n  v_actor := auth.uid();\n  -- Lock the authorization rows until the write transaction completes.';
  v_branch constant text := $branch$
  if tg_table_schema='public'
     and tg_table_name in ('crate_types','products')
     and tg_op='INSERT'
     and new.business_id is not null
     and new.business_id is distinct from v_business then
    if not exists (
      select 1 from private.business_assortment_setup_gate
      where enabled is true
    ) then
      raise exception 'Business assortment setup is not available'
        using errcode='42501';
    end if;
    v_actor:=auth.uid();
    if v_actor is null then
      raise exception 'Verified business owner session required'
        using errcode='42501';
    end if;
    perform 1 from private.business_memberships m
      join private.businesses b on b.id=m.business_id
      where m.business_id=new.business_id and m.user_id=v_actor
        and m.member_kind='owner' and m.status='active'
        and b.status in ('setup','active') and b.legacy_singleton is null
      for share of m,b;
    if not found then
      raise exception 'Business not available' using errcode='42501';
    end if;
    return new;
  end if;

$branch$;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
     or (length(v_source)-length(replace(v_source,v_anchor,'')))
          /length(v_anchor)<>1
     or pg_catalog.strpos(v_source,'private.business_receiving_gate')=0
     or pg_catalog.strpos(v_source,'private.business_assortment_setup_gate')<>0 then
    raise exception 'Assortment scope trigger drift; manual review required';
  end if;
  execute replace(v_source,v_anchor,v_branch||v_anchor);
end;
$extend_assortment_scope$;

create function public.create_business_crate_type(
  p_business_id uuid, p_crate_type_id uuid, p_name text,
  p_empty_family text, p_pocket_count integer, p_variant text
) returns uuid
language plpgsql security definer set search_path=''
as $create_crate$
declare
  v_actor uuid := auth.uid();
  v_name text := pg_catalog.btrim(p_name);
  v_family text := pg_catalog.btrim(p_empty_family);
  v_variant text := nullif(pg_catalog.btrim(p_variant),'');
  v_crate public.crate_types%rowtype;
begin
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.status in ('setup','active') and b.legacy_singleton is null
    for share of m,b;
  if not found then
    raise exception 'Business not available' using errcode='42501';
  end if;
  perform 1 from private.business_assortment_setup_gate
    where enabled is true for share;
  if not found or not exists(
    select 1 from private.legacy_write_scope_gate where enabled is true
  ) then
    raise exception 'Business assortment setup is not available'
      using errcode='42501';
  end if;
  if p_crate_type_id is null
     or v_name is null or length(v_name) not between 1 and 120
     or v_family is null or length(v_family) not between 1 and 80
     or length(v_variant)>120
     or p_pocket_count is null or p_pocket_count<=0 or p_pocket_count>24 then
    raise exception 'Choose a named physical crate with a valid pocket count'
      using errcode='22023';
  end if;

  -- IDs are opaque business-local identities, NOT interchangeable merely
  -- because capacity/family match. A shared 33/Life/Goldberg type is reused
  -- by providing this exact ID; Gulder/Heineken receive distinct IDs.
  insert into public.crate_types(
    id,business_id,name,empty_family,pocket_count,variant,is_legacy
  ) values (
    p_crate_type_id,p_business_id,v_name,v_family,p_pocket_count,v_variant,false
  ) on conflict(id) do nothing;
  select * into v_crate from public.crate_types
   where id=p_crate_type_id and business_id=p_business_id;
  if not found
     or v_crate.name is distinct from v_name
     or v_crate.empty_family is distinct from v_family
     or v_crate.pocket_count is distinct from p_pocket_count
     or v_crate.variant is distinct from v_variant
     or v_crate.is_legacy is distinct from false then
    raise exception 'Crate ID already used with different details'
      using errcode='22023';
  end if;
  return v_crate.id;
end;
$create_crate$;
revoke all on function public.create_business_crate_type(
  uuid,uuid,text,text,integer,text
) from public,anon,authenticated,service_role;

create function public.add_business_catalogue_drink(
  p_business_id uuid, p_product_id uuid, p_catalogue_product_id uuid,
  p_crate_type_id uuid, p_bottles_per_crate integer,
  p_full_crate_price integer, p_half_crate_price integer,
  p_quarter_crate_price integer, p_bottle_price integer,
  p_bottles_returnable boolean, p_bottle_type text, p_size text
) returns uuid
language plpgsql security definer set search_path=''
as $add_drink$
declare
  v_actor uuid := auth.uid();
  v_crate public.crate_types%rowtype;
  v_product public.products%rowtype;
  v_name text;
  v_size text := nullif(pg_catalog.btrim(p_size),'');
  v_bottle_type text := nullif(pg_catalog.btrim(p_bottle_type),'');
begin
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.status in ('setup','active') and b.legacy_singleton is null
    for share of m,b;
  if not found then
    raise exception 'Business not available' using errcode='42501';
  end if;
  perform 1 from private.business_assortment_setup_gate
    where enabled is true for share;
  if not found or not exists(
    select 1 from private.legacy_write_scope_gate where enabled is true
  ) then
    raise exception 'Business assortment setup is not available'
      using errcode='42501';
  end if;
  if p_product_id is null or p_catalogue_product_id is null
     or p_crate_type_id is null or p_bottles_per_crate is null
     or p_bottles_per_crate<=0 or p_bottles_per_crate>24
     or p_full_crate_price is null or p_full_crate_price<0
     or p_full_crate_price%50<>0
     or (p_half_crate_price is not null
         and (p_half_crate_price<0 or p_half_crate_price%50<>0))
     or (p_quarter_crate_price is not null
         and (p_quarter_crate_price<0 or p_quarter_crate_price%50<>0))
     or (p_bottle_price is not null
         and (p_bottle_price<0 or p_bottle_price%50<>0))
     or p_bottles_returnable is null
     or length(v_size)>120
     or length(v_bottle_type)>120
     or (p_bottles_returnable and v_bottle_type is null) then
    raise exception 'Check drink, crate, returnable bottle and N50 prices'
      using errcode='22023';
  end if;

  select * into v_crate from public.crate_types
    where id=p_crate_type_id and business_id=p_business_id
      and is_legacy is false for share;
  if not found or v_crate.pocket_count is distinct from p_bottles_per_crate
     or v_crate.empty_family is null then
    raise exception 'Choose your exact physical crate with matching pockets'
      using errcode='22023';
  end if;
  select name into v_name from public.product_catalogue
    where id=p_catalogue_product_id;
  if not found then
    raise exception 'Master catalogue drink not found'
      using errcode='22023';
  end if;

  -- UUID retries never edit prices, change crate identity or overwrite stock.
  -- The business-qualified master catalogue index prevents duplicate
  -- configurations IN ONE depot while allowing the same item across depots.
  insert into public.products(
    id,business_id,catalogue_product_id,name,size,crate_type_id,
    bottles_per_crate,full_crate_price,half_crate_price,
    quarter_crate_price,bottle_price,bottles_returnable,bottle_type,
    empty_family,is_active
  ) values (
    p_product_id,p_business_id,p_catalogue_product_id,v_name,v_size,
    p_crate_type_id,p_bottles_per_crate,p_full_crate_price,
    p_half_crate_price,p_quarter_crate_price,p_bottle_price,
    p_bottles_returnable,v_bottle_type,v_crate.empty_family,true
  ) on conflict do nothing;
  select * into v_product from public.products
   where id=p_product_id and business_id=p_business_id;
  if not found
     or v_product.catalogue_product_id is distinct from p_catalogue_product_id
     or v_product.crate_type_id is distinct from p_crate_type_id
     or v_product.name is distinct from v_name
     or v_product.size is distinct from v_size
     or v_product.bottles_per_crate is distinct from p_bottles_per_crate
     or v_product.full_crate_price is distinct from p_full_crate_price
     or v_product.half_crate_price is distinct from p_half_crate_price
     or v_product.quarter_crate_price is distinct from p_quarter_crate_price
     or v_product.bottle_price is distinct from p_bottle_price
     or v_product.bottles_returnable is distinct from p_bottles_returnable
     or v_product.bottle_type is distinct from v_bottle_type
     or v_product.is_active is distinct from true then
    raise exception 'Drink ID or catalogue drink already configured differently'
      using errcode='22023';
  end if;
  return v_product.id;
end;
$add_drink$;
revoke all on function public.add_business_catalogue_drink(
  uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,
  boolean,text,text
) from public,anon,authenticated,service_role;
commit;
