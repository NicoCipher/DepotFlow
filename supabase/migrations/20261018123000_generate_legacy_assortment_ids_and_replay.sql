-- M2: eliminate original-shop crate/product caller-selected global PKs before
-- any second-depot assortment is activated. Existing IDs, stock, empties,
-- prices, edits and transaction/receipt history are NOT rewritten.
-- Client p_request_id is a retry token; never an inserted record ID.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.legacy_assortment_creation_requests (
  owner_id uuid not null references auth.users(id) on delete restrict,
  resource_kind text not null check(resource_kind in ('crate','product')),
  request_id uuid not null,
  record_id uuid not null unique,
  details jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key(owner_id,resource_kind,request_id)
);
alter table private.legacy_assortment_creation_requests enable row level security;
revoke all on private.legacy_assortment_creation_requests
  from public,anon,authenticated,service_role;

create function private.assert_legacy_assortment_owner()
returns uuid language plpgsql volatile security definer set search_path=''
as $guard$
declare
 v_actor uuid:=auth.uid();
 v_business uuid;
begin
 if v_actor is null or not private.verified_legacy_owner_read() then
   raise exception 'Verified original shop ownership required' using errcode='42501';
 end if;
 perform 1 from private.shop_owner where user_id=v_actor for share;
 if not found then
   raise exception 'Original shop ownership required' using errcode='42501';
 end if;
 select business_id into v_business from private.legacy_write_scope_gate
   where enabled is true for share;
 if v_business is not null then
   perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=v_business and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is true and b.status='active'
    for share of m,b;
   if not found then
     raise exception 'Original shop owner is no longer active' using errcode='42501';
   end if;
 end if;
 return v_actor;
end;
$guard$;
revoke all on function private.assert_legacy_assortment_owner()
  from public,anon,authenticated,service_role;

create function public.create_legacy_crate_type(
  p_request_id uuid, p_name text, p_empty_family text,
  p_pocket_count integer, p_variant text
) returns uuid language plpgsql volatile security definer set search_path=''
as $create_crate$
declare
 v_actor uuid:=private.assert_legacy_assortment_owner();
 v_name text:=pg_catalog.btrim(p_name);
 v_family text:=pg_catalog.btrim(p_empty_family);
 v_variant text:=pg_catalog.nullif(pg_catalog.btrim(p_variant),'');
 v_details jsonb;
 v_saved private.legacy_assortment_creation_requests%rowtype;
 v_id uuid;
begin
 if p_request_id is null or v_name is null
    or pg_catalog.length(v_name) not between 1 and 120
    or v_family is null or pg_catalog.length(v_family) not between 1 and 80
    or pg_catalog.length(v_variant)>120
    or p_pocket_count is null or p_pocket_count not between 1 and 120
    or v_name ~ '[[:cntrl:]]' or v_family ~ '[[:cntrl:]]'
    or coalesce(v_variant,'') ~ '[[:cntrl:]]' then
   raise exception 'Enter an exact crate with 1 to 120 bottle spaces'
     using errcode='22023';
 end if;
 v_details:=pg_catalog.jsonb_build_object('name',v_name,'family',v_family,
     'pockets',p_pocket_count,'variant',v_variant);
 perform pg_catalog.pg_advisory_xact_lock(
     pg_catalog.hashtextextended('legacy-assortment:'||v_actor::text,0));
 select * into v_saved from private.legacy_assortment_creation_requests
  where owner_id=v_actor and resource_kind='crate' and request_id=p_request_id
  for update;
 if found then
   if v_saved.details is distinct from v_details then
     raise exception 'This crate form was already used with different details'
       using errcode='22023';
   end if;
   if not exists(select 1 from public.crate_types where id=v_saved.record_id) then
     raise exception 'The previously saved crate was removed. Start a new form'
       using errcode='P0002';
   end if;
   return v_saved.record_id;
 end if;
 -- Never query a caller-supplied global PK, including foreign depot rows.
 v_id:=pg_catalog.gen_random_uuid();
 insert into public.crate_types(id,name,empty_family,pocket_count,variant)
 values(v_id,v_name,v_family,p_pocket_count,v_variant);
 insert into private.legacy_assortment_creation_requests(
   owner_id,resource_kind,request_id,record_id,details
 ) values(v_actor,'crate',p_request_id,v_id,v_details);
 return v_id;
end;
$create_crate$;

create function public.create_legacy_product(
 p_request_id uuid, p_name text, p_size text, p_image_url text,
 p_crate_type_id uuid, p_bottles_per_crate integer,
 p_full_crate_price integer, p_half_crate_price integer,
 p_quarter_crate_price integer, p_bottle_price integer,
 p_bottles_returnable boolean, p_bottle_type text,
 p_catalogue_product_id uuid
) returns uuid language plpgsql volatile security definer set search_path=''
as $create_product$
declare
 v_actor uuid:=private.assert_legacy_assortment_owner();
 v_name text:=pg_catalog.btrim(pg_catalog.regexp_replace(p_name,'[[:space:]]+',' ','g'));
 v_size text:=pg_catalog.nullif(pg_catalog.btrim(p_size),'');
 v_image text:=pg_catalog.nullif(pg_catalog.btrim(p_image_url),'');
 v_bottle text:=pg_catalog.nullif(pg_catalog.btrim(p_bottle_type),'');
 v_crate public.crate_types%rowtype;
 v_details jsonb;
 v_saved private.legacy_assortment_creation_requests%rowtype;
 v_id uuid;
begin
 if p_request_id is null or v_name is null
    or pg_catalog.length(v_name) not between 1 and 120
    or pg_catalog.length(v_size)>80 or pg_catalog.length(v_image)>2048
    or pg_catalog.length(v_bottle)>120
    or v_name ~ '[[:cntrl:]]' or coalesce(v_size,'') ~ '[[:cntrl:]]'
    or coalesce(v_image,'') ~ '[[:cntrl:]]' or coalesce(v_bottle,'') ~ '[[:cntrl:]]'
    or (v_image is not null and (v_image !~ '^https?://' or v_image ~ '^[^:]+://[^/]*@'))
    or p_crate_type_id is null or p_bottles_per_crate is null
    or p_bottles_per_crate not between 1 and 120
    or p_full_crate_price is null or p_full_crate_price<0 or p_full_crate_price%50<>0
    or (p_half_crate_price is not null
       and (p_half_crate_price<0 or p_half_crate_price%50<>0))
    or (p_quarter_crate_price is not null
       and (p_quarter_crate_price<0 or p_quarter_crate_price%50<>0))
    or (p_bottle_price is not null
       and (p_bottle_price<0 or p_bottle_price%50<>0))
    or p_bottles_returnable is null
    or (p_bottles_returnable and v_bottle is null)
    or (not p_bottles_returnable and v_bottle is not null) then
   raise exception 'Check drink, physical crate, bottle and prices'
     using errcode='22023';
 end if;
 -- Only the exact physical crate selected by the ORIGINAL business may be used.
 -- Never reveal a foreign record's attributes or id existence through this API.
 select * into v_crate from public.crate_types
  where id=p_crate_type_id
    and (business_id is null or business_id=
      (select business_id from private.legacy_write_scope_gate
       where enabled is true))
    for share;
 if not found or v_crate.is_legacy or v_crate.empty_family is null
    or v_crate.pocket_count is distinct from p_bottles_per_crate then
   raise exception 'Choose an exact physical crate with matching bottle spaces'
     using errcode='22023';
 end if;
 if p_catalogue_product_id is not null and not exists(
   select 1 from public.product_catalogue where id=p_catalogue_product_id) then
   raise exception 'Select the drink from the catalogue again' using errcode='22023';
 end if;
 v_details:=pg_catalog.jsonb_build_object(
   'name',v_name,'size',v_size,'image',v_image,
   'crate',p_crate_type_id,'pack',p_bottles_per_crate,
   'full',p_full_crate_price,'half',p_half_crate_price,
   'quarter',p_quarter_crate_price,'bottle',p_bottle_price,
   'returnable',p_bottles_returnable,'bottleType',v_bottle,
   'catalogue',p_catalogue_product_id);
 perform pg_catalog.pg_advisory_xact_lock(
     pg_catalog.hashtextextended('legacy-assortment:'||v_actor::text,0));
 select * into v_saved from private.legacy_assortment_creation_requests
  where owner_id=v_actor and resource_kind='product' and request_id=p_request_id
  for update;
 if found then
   if v_saved.details is distinct from v_details then
     raise exception 'This drink form was already used with different details'
       using errcode='22023';
   end if;
   if not exists(select 1 from public.products where id=v_saved.record_id) then
     raise exception 'The previously saved drink was removed. Start a new form'
       using errcode='P0002';
   end if;
   return v_saved.record_id;
 end if;
 if p_catalogue_product_id is not null and exists (
    select 1 from public.products
     where catalogue_product_id=p_catalogue_product_id
       and (business_id is null or business_id=
         (select business_id from private.legacy_write_scope_gate
           where enabled is true))) then
   raise exception 'This catalogue drink is already in your shop'
     using errcode='22023';
 end if;
 v_id:=pg_catalog.gen_random_uuid();
 insert into public.products(
   id,name,size,image_url,crate_type_id,bottles_per_crate,
   full_crate_price,half_crate_price,quarter_crate_price,bottle_price,
   bottles_returnable,bottle_type,catalogue_product_id,empty_family
 ) values(
   v_id,v_name,v_size,v_image,p_crate_type_id,p_bottles_per_crate,
   p_full_crate_price,p_half_crate_price,p_quarter_crate_price,p_bottle_price,
   p_bottles_returnable,v_bottle,p_catalogue_product_id,v_crate.empty_family
 );
 insert into private.legacy_assortment_creation_requests(
   owner_id,resource_kind,request_id,record_id,details
 ) values(v_actor,'product',p_request_id,v_id,v_details);
 return v_id;
end;
$create_product$;

-- Remove the old caller-selected-ID API from ALL signed-in clients.
-- Original shop crate metadata edits stay callable, but creation uses the
-- new RPC which chooses the actual PK and returns it to the UI.
revoke execute on function public.create_crate_type(uuid,text,text,numeric,text)
 from public,anon,authenticated,service_role;
revoke execute on function private.create_crate_type(uuid,text,text,numeric,text)
 from public,anon,authenticated,service_role;

-- A direct INSERT without an id could silently default a UUID and evade
-- immutable audit, so revoke EVERY authenticated product INSERT column.
revoke insert on public.products from authenticated;
do $revoke_product_insert$
declare v text;
begin
 for v in select a.attname from pg_catalog.pg_attribute a
    where a.attrelid='public.products'::regclass
      and a.attnum>0 and not a.attisdropped loop
   execute pg_catalog.format('revoke insert (%I) on public.products from authenticated',v);
 end loop;
end;
$revoke_product_insert$;

revoke all on function public.create_legacy_crate_type(uuid,text,text,integer,text)
 from public,anon,authenticated,service_role;
revoke all on function public.create_legacy_product(
 uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.create_legacy_crate_type(uuid,text,text,integer,text)
 to authenticated;
grant execute on function public.create_legacy_product(
 uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)
 to authenticated;

do $verify$
begin
 if has_function_privilege('authenticated',
     'public.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
 or has_function_privilege('authenticated',
     'private.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
 or has_function_privilege('anon',
     'public.create_legacy_crate_type(uuid,text,text,integer,text)','EXECUTE')
 or has_function_privilege('anon',
     'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE')
 or has_any_column_privilege('authenticated','public.products','INSERT')
 or not has_column_privilege('authenticated','public.products','name','UPDATE')
 or not has_function_privilege('authenticated',
     'public.create_legacy_crate_type(uuid,text,text,integer,text)','EXECUTE')
 or not has_function_privilege('authenticated',
     'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE')
 then
   raise exception 'Legacy assortment identity grant boundary is unsafe';
 end if;
end;
$verify$;
commit;
