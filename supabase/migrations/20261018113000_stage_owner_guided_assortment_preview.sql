-- M2f-39: one limited owner-scoped view for guided drink and crate setup.
-- No cross-depot product/price reads or rights to create inventory.
-- New-business assortment gate remains OFF and this read RPC ungranted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.preview_business_assortment_setup(p_business_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $preview$
declare
 v_actor uuid:=auth.uid();
 v_catalogue jsonb;
 v_crates jsonb;
 v_products jsonb;
begin
 if v_actor is null or p_business_id is null then
  raise exception 'Verified depot owner required' using errcode='42501';
 end if;
 perform 1 from private.business_memberships m
 join private.businesses b on b.id=m.business_id
 where m.user_id=v_actor and m.business_id=p_business_id
   and m.member_kind='owner' and m.status='active'
   and b.legacy_singleton is null and b.status='setup'
 for share of m,b;
 if not found then
  raise exception 'This depot is not available for setup'
    using errcode='42501';
 end if;
 perform 1 from private.business_assortment_setup_gate
  where enabled is true for share;
 if not found or not exists(
  select 1 from private.business_selection_gate where enabled is true
 ) then
  raise exception 'Guided drinks setup has not been enabled'
    using errcode='42501';
 end if;

 -- Shared public catalogue has names/photos only, NEVER another shop's
 -- costs, selling prices, quantities or customer data.
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',c.id,'name',c.name,'manufacturer',c.manufacturer,
   'imagePath',c.image_path
 ) order by c.name,c.id),'[]'::jsonb)
 into v_catalogue
 from (
  select id,name,manufacturer,image_path
  from public.product_catalogue order by name,id limit 250
 ) c;

 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',c.id,'name',c.name,'family',c.empty_family,
   'pockets',c.pocket_count,'variant',c.variant
 ) order by c.name,c.id),'[]'::jsonb)
 into v_crates
 from (
  select id,name,empty_family,pocket_count,variant
  from public.crate_types
  where business_id=p_business_id and is_legacy is false
  order by name,id limit 250
 ) c;

 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',p.id,'catalogueId',p.catalogue_product_id,
   'name',p.name,'crateTypeId',p.crate_type_id,
   'packSize',p.bottles_per_crate,
   'returnable',p.bottles_returnable,'bottleType',p.bottle_type,
   'sellingPrice',p.full_crate_price,'active',p.is_active
 ) order by p.name,p.id),'[]'::jsonb)
 into v_products
 from (
  select id,catalogue_product_id,name,crate_type_id,bottles_per_crate,
   bottles_returnable,bottle_type,full_crate_price,is_active
  from public.products
  where business_id=p_business_id
  order by name,id limit 250
 ) p;

 return pg_catalog.jsonb_build_object(
  'businessId',p_business_id,'businessStatus','setup',
  'catalogue',v_catalogue,'crateTypes',v_crates,'configuredDrinks',v_products,
  'readOnly',true,'canActivate',false
 );
end;
$preview$;
revoke all on function public.preview_business_assortment_setup(uuid)
 from public,anon,authenticated,service_role;
commit;
