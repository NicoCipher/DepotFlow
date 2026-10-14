begin;
-- Real Maltina can and glass bottle packshots for the master catalogue.
-- Images are independent of stock; never overwrite any owner-selected photo.
with images(catalogue_name,slug) as (
  values
    ('Maltina','maltina-classic-glass-33cl'),
    ('Maltina Can','maltina-classic-can-33cl')
), updated as (
  update public.product_catalogue as c
  set image_path='first-party/' || images.slug || '.webp'
  from images
  where c.name=images.catalogue_name and c.image_path is null
  returning c.id, c.image_path
)
update public.products as p
set image_url='/catalogue-photos/' || substring(updated.image_path from 13)
from updated
where p.catalogue_product_id=updated.id
  and p.image_url is null;
commit;
