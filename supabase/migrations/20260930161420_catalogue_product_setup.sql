begin;

-- Product setup saves the catalogue link together with the configured drink.
-- Existing owner-only INSERT policy and unique catalogue index still apply.
grant insert (catalogue_product_id) on public.products to authenticated;

commit;
