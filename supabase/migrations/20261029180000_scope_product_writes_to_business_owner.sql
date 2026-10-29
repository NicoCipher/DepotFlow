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

-- RLS expressions execute with the caller's table privileges. The gate
-- tables intentionally deny SELECT to authenticated, so read them only
-- through this narrowly scoped SECURITY DEFINER predicate.
create function private.can_insert_tenant_product(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select p_business_id is not null
    and exists (
      select 1 from private.legacy_write_scope_gate g
      where g.enabled is true
    )
    and exists (
      select 1 from private.business_assortment_setup_gate g
      where g.enabled is true
    )
    and private.owns_new_business(p_business_id);
$function$;

revoke all on function private.can_insert_tenant_product(uuid)
  from public, anon, service_role;
grant execute on function private.can_insert_tenant_product(uuid)
  to authenticated;

-- The earlier cutover revoked direct product INSERT completely. Restore only
-- the columns needed by the guarded tenant path; deliberately omit `id` so
-- callers cannot choose globally colliding product UUIDs. RLS still requires
-- the legacy business predicate OR both rollout gates plus exact ownership.
grant insert (business_id, name, size, image_url, bottles_per_crate,
  full_crate_price, half_crate_price, quarter_crate_price, bottle_price,
  bottles_returnable, empty_family, crate_type, bottle_type)
  on public.products to authenticated;

alter policy owner_insert_product on public.products
  with check (
    private.can_read_legacy_customer(business_id)
    or private.can_insert_tenant_product(business_id)
  );

alter policy owner_update_product on public.products
  using (private.can_read_legacy_customer(business_id))
  with check (private.can_read_legacy_customer(business_id));

commit;
