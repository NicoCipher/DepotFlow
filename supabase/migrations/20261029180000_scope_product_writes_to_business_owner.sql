-- M2 security repair: scope product writes to the row's authorized business.
--
-- The existing owner_insert_product / owner_update_product policies checked
-- only is_shop_owner(). The products SELECT policy is tenant-scoped, but the
-- INSERT policy can still accept a caller-supplied business_id, and the
-- UPDATE WITH CHECK can allow a legacy owner to reassign a visible product
-- to a different business while the legacy write-scope gate is closed.
--
-- Keep the legacy workflow intact. New-business product INSERT is allowed
-- only after both the write-scope and assortment-setup gates are enabled and
-- the authenticated actor owns that exact new business. New-business UPDATE
-- remains denied until the operational write trigger has a reviewed,
-- business-scoped UPDATE path; fail closed rather than imply it is ready.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter policy owner_insert_product on public.products
  with check (private.can_read_legacy_customer(business_id));

-- New-business catalogue writes must use the SECURITY DEFINER RPC, which
-- validates active ownership, both rollout gates, catalogue identity, and a
-- crate belonging to the same business. Direct table INSERT stays revoked:
-- it cannot safely validate crate_type_id or master-catalogue linkage.
-- Both steps of guided assortment setup must be callable by authenticated
-- owners. Each SECURITY DEFINER RPC independently verifies active ownership
-- and both rollout gates (which remain OFF by default); anon stays denied.
grant execute on function public.create_business_crate_type(
  uuid,uuid,text,text,integer,text
) to authenticated;
grant execute on function public.add_business_catalogue_drink(
  uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text
) to authenticated;

alter policy owner_update_product on public.products
  using (private.can_read_legacy_customer(business_id))
  with check (private.can_read_legacy_customer(business_id));

commit;
