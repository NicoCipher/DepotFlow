begin;

-- A first-party packshot is bundled and served by DepotFlow itself.
-- It has a database reference, not an external retailer URL.
-- Owner-uploaded Supabase Storage photos retain their existing path format.
alter table public.product_catalogue drop constraint if exists product_catalogue_image_path_shape;
alter table public.product_catalogue add constraint product_catalogue_image_path_shape check (
  image_path is null
  or image_path ~* '^catalogue/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(webp|png|jpg|jpeg)$'
  or image_path ~ '^first-party/[a-z0-9][a-z0-9-]*\.webp$'
);

-- Never replace an owner-selected existing picture. The catalogue only
-- starts with this file if it did not have its own managed photo already.
with saved_catalogue as (
  update public.product_catalogue
  set image_path = 'first-party/goldberg-60cl.webp'
  where name = 'Goldberg' and image_path is null
  returning id
)
update public.products as p
set image_url = '/catalogue-photos/goldberg-60cl.webp'
from saved_catalogue as c
where p.catalogue_product_id = c.id and p.image_url is null;

commit;
