-- M2f-1: scope inventory READS to their owning business.
--
-- Existing shop assortment/stock and exact branded empties are already
-- business-tagged by M2a and backfilled through the audited M2b workflow.
-- Those nullable tags must not be used as a GLOBAL is_shop_owner() escape.
-- Preserve all old mutations/RPCs and bans on new shop receiving, sales,
-- crate changes and bottle counts: this migration grants no write access.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function private.can_read_tenant_inventory(p_business_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select private.can_read_legacy_customer(p_business_id)
     or private.can_manage_new_customer(p_business_id);
$$;
revoke all on function private.can_read_tenant_inventory(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.can_read_tenant_inventory(uuid)
  to authenticated;

-- The master catalogue contains only global identity, manufacturer
-- and image_path (NO business cost/sale price). Active new shop owners
-- must be able to browse it before configuring their own assortment.
-- Do not grant them master catalogue UPDATE, including image_path changes.
create function private.can_read_shared_product_catalogue()
returns boolean
language sql stable security definer set search_path=''
as $catalogue$
  select private.verified_legacy_owner_read()
    or (
      exists(select 1 from private.legacy_write_scope_gate where enabled is true)
      and auth.uid() is not null
      and exists(
        select 1 from private.business_memberships m
        join private.businesses b on b.id=m.business_id
        where m.user_id=auth.uid()
          and m.member_kind='owner' and m.status='active'
          and b.legacy_singleton is null
          and b.status in ('setup','active')
      )
    );
$catalogue$;
revoke all on function private.can_read_shared_product_catalogue()
  from public,anon,authenticated,service_role;
grant execute on function private.can_read_shared_product_catalogue()
  to authenticated;
alter policy owner_read on public.product_catalogue
  using (private.can_read_shared_product_catalogue());

-- Products carry shop-specific prices, display state, catalogue reference,
-- and branded crate type; product_catalogue remains global read-only master.
-- Stock and stock movements follow the same exact business ownership.
alter policy owner_read on public.products
  using (private.can_read_tenant_inventory(business_id));
alter policy owner_read on public.stock
  using (private.can_read_tenant_inventory(business_id));
alter policy owner_read on public.stock_movements
  using (private.can_read_tenant_inventory(business_id));

-- Crate types are currently shop-branded records, not generic '12 pocket'
-- substitutions. Keep distinct exact identities and brewery information.
alter policy owner_read on public.crate_types
  using (private.can_read_tenant_inventory(business_id));
alter policy owner_read on public.empty_crate_stock
  using (private.can_read_tenant_inventory(business_id));
alter policy owner_read on public.empty_crate_movements
  using (private.can_read_tenant_inventory(business_id));
alter policy owner_read on public.empty_bottle_stock
  using (private.can_read_tenant_inventory(business_id));

-- IMPORTANT NOT-YET-SOLVED SCHEMA LIMITATIONS:
-- empty_crate_stock has a GLOBAL primary key on crate_type_id;
-- empty_bottle_stock has a GLOBAL bottle_type primary key.
-- Neither can correctly hold the same physical empty identity for multiple
-- businesses without revisiting uniqueness, stock updates and every RPC.
-- This migration does NOT permit new owner inserts, stock counts,
-- receiving, returning empties, or sale/receipt transactions.
commit;
