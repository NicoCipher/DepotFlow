begin;
-- Real, verified 33cl Maltina Classic can photograph for the master catalogue.
-- The unqualified 'Maltina' row is deliberately untouched until its package and size are confirmed.
-- No owner-selected image or other business data may be overwritten.
with updated as (
  update public.product_catalogue
  set image_path='first-party/maltina-classic-can-33cl.webp'
  where name='Maltina Can' and image_path is null
  returning id
)
update public.products as p
set image_url='/catalogue-photos/maltina-classic-can-33cl.webp'
from updated
where p.catalogue_product_id=updated.id
  and p.image_url is null;
commit;
