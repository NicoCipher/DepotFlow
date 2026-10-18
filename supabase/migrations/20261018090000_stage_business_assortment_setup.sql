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

-- A submitted UUID is a replay token, NEVER a global crate/product PK.
-- Request identity is (business, kind, token); immutable request details
-- survive retries while generated records remain impossible to select by UUID.
create table private.business_assortment_setup_requests (
  business_id uuid not null references private.businesses(id) on delete restrict,
  kind text not null check (kind in ('crate','drink')),
  request_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  record_id uuid not null unique,
  details jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (business_id,kind,request_id)
);
alter table private.business_assortment_setup_requests enable row level security;
revoke all on private.business_assortment_setup_requests
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
language plpgsql volatile security definer set search_path=''
as $create_crate$
declare
  v_actor uuid := auth.uid();
  v_name text := pg_catalog.btrim(p_name);
  v_family text := pg_catalog.btrim(p_empty_family);
  v_variant text := nullif(pg_catalog.btrim(p_variant),'');
  v_details jsonb;
  v_record_id uuid;
  v_saved private.business_assortment_setup_requests%rowtype;
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
  -- p_crate_type_id is retained as an API parameter for compatibility,
  -- but it is solely a tenant-qualified retry token, not an inserted PK.
  if p_crate_type_id is null
     or v_name is null or length(v_name) not between 1 and 120
     or v_family is null or length(v_family) not between 1 and 80
     or length(v_variant)>120
     or p_pocket_count is null or p_pocket_count not between 1 and 120
     or v_name ~ '[[:cntrl:]]'
     or v_family ~ '[[:cntrl:]]'
     or coalesce(v_variant,'') ~ '[[:cntrl:]]' then
    raise exception 'Choose a named physical crate with 1 to 120 pockets'
      using errcode='22023';
  end if;
  v_details:=pg_catalog.jsonb_build_object(
    'name',v_name,'family',v_family,'pockets',p_pocket_count,
    'variant',v_variant
  );
  -- Serialize all assortment requests within this business. A foreign
  -- token collision never checks a foreign global record or its PK.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'depotflow-assortment:'||p_business_id::text,0
  ));
  select * into v_saved
    from private.business_assortment_setup_requests
    where business_id=p_business_id and kind='crate'
      and request_id=p_crate_type_id for update;
  if found then
    if v_saved.owner_id is distinct from v_actor
       or v_saved.details is distinct from v_details then
      raise exception 'Crate request already used with different details'
        using errcode='22023';
    end if;
    return v_saved.record_id;
  end if;
  v_record_id:=pg_catalog.gen_random_uuid();
  insert into public.crate_types(
    id,business_id,name,empty_family,pocket_count,variant,is_legacy
  ) values (
    v_record_id,p_business_id,v_name,v_family,p_pocket_count,v_variant,false
  );
  insert into private.business_assortment_setup_requests(
    business_id,kind,request_id,owner_id,record_id,details
  ) values (p_business_id,'crate',p_crate_type_id,v_actor,v_record_id,v_details);
  return v_record_id;
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
language plpgsql volatile security definer set search_path=''
as $add_drink$
declare
  v_actor uuid := auth.uid();
  v_crate public.crate_types%rowtype;
  v_name text;
  v_size text := nullif(pg_catalog.btrim(p_size),'');
  v_bottle_type text := nullif(pg_catalog.btrim(p_bottle_type),'');
  v_details jsonb;
  v_record_id uuid;
  v_saved private.business_assortment_setup_requests%rowtype;
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
  -- p_product_id is a retry token, never the caller-selected product PK.
  if p_product_id is null or p_catalogue_product_id is null
     or p_crate_type_id is null or p_bottles_per_crate is null
     or p_bottles_per_crate not between 1 and 120
     or p_full_crate_price is null or p_full_crate_price<50
     or p_full_crate_price%50<>0
     or (p_half_crate_price is not null
         and (p_half_crate_price<0 or p_half_crate_price%50<>0))
     or (p_quarter_crate_price is not null
         and (p_quarter_crate_price<0 or p_quarter_crate_price%50<>0))
     or (p_bottle_price is not null
         and (p_bottle_price<0 or p_bottle_price%50<>0))
     or p_bottles_returnable is null
     or length(v_size)>120 or length(v_bottle_type)>120
     or coalesce(v_size,'') ~ '[[:cntrl:]]'
     or coalesce(v_bottle_type,'') ~ '[[:cntrl:]]'
     or (p_bottles_returnable and v_bottle_type is null)
     or (not p_bottles_returnable and v_bottle_type is not null) then
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
  v_details:=pg_catalog.jsonb_build_object(
    'catalogue',p_catalogue_product_id,'crate',p_crate_type_id,
    'pack',p_bottles_per_crate,'full',p_full_crate_price,
    'half',p_half_crate_price,'quarter',p_quarter_crate_price,
    'bottle',p_bottle_price,'returnable',p_bottles_returnable,
    'bottleType',v_bottle_type,'size',v_size
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'depotflow-assortment:'||p_business_id::text,0
  ));
  select * into v_saved
    from private.business_assortment_setup_requests
    where business_id=p_business_id and kind='drink'
      and request_id=p_product_id for update;
  if found then
    if v_saved.owner_id is distinct from v_actor
       or v_saved.details is distinct from v_details then
      raise exception 'Drink request already used with different details'
        using errcode='22023';
    end if;
    return v_saved.record_id;
  end if;
  if exists(select 1 from public.products
     where business_id=p_business_id
       and catalogue_product_id=p_catalogue_product_id) then
    raise exception 'Catalogue drink already configured for this depot'
      using errcode='22023';
  end if;
  v_record_id:=pg_catalog.gen_random_uuid();
  insert into public.products(
    id,business_id,catalogue_product_id,name,size,crate_type_id,
    bottles_per_crate,full_crate_price,half_crate_price,
    quarter_crate_price,bottle_price,bottles_returnable,bottle_type,
    empty_family,is_active
  ) values (
    v_record_id,p_business_id,p_catalogue_product_id,v_name,v_size,
    p_crate_type_id,p_bottles_per_crate,p_full_crate_price,
    p_half_crate_price,p_quarter_crate_price,p_bottle_price,
    p_bottles_returnable,v_bottle_type,v_crate.empty_family,true
  );
  insert into private.business_assortment_setup_requests(
    business_id,kind,request_id,owner_id,record_id,details
  ) values (p_business_id,'drink',p_product_id,v_actor,v_record_id,v_details);
  return v_record_id;
end;
$add_drink$;
revoke all on function public.add_business_catalogue_drink(
  uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,
  boolean,text,text
) from public,anon,authenticated,service_role;
commit;
