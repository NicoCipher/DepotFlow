begin;

-- Shared catalogue photo reference; actual bytes live in Storage, not PostgreSQL.
-- Only the shop owner can change this field. Existing catalogue readers stay unchanged.
alter table public.product_catalogue
  add column if not exists image_path text;

alter table public.product_catalogue
  add constraint product_catalogue_image_path_shape
  check (
    image_path is null or image_path ~*
    '^catalogue/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.(webp|png|jpg|jpeg)$'
  );

grant update (image_path) on public.product_catalogue to authenticated;

create policy owner_update_catalogue_image
on public.product_catalogue for update to authenticated
using ((select public.is_shop_owner()))
with check ((select public.is_shop_owner()));

commit;
