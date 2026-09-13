begin;

-- Keep owner_read unchanged. No stock or other table grants are added.
grant insert (id, name, size, image_url, bottles_per_crate, full_crate_price,
  half_crate_price, quarter_crate_price, bottle_price, bottles_returnable,
  empty_family, crate_type, bottle_type) on public.products to authenticated;
grant update (name, size, image_url, bottles_per_crate, full_crate_price,
  half_crate_price, quarter_crate_price, bottle_price, bottles_returnable,
  empty_family, crate_type, bottle_type) on public.products to authenticated;

create policy owner_insert_product on public.products for insert to authenticated
  with check ((select public.is_shop_owner()));
create policy owner_update_product on public.products for update to authenticated
  using ((select public.is_shop_owner()))
  with check ((select public.is_shop_owner()));

commit;
