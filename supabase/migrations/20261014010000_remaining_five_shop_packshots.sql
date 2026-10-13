begin;

-- Second manually inspected five-image shop pilot: strictly source-matched variants.
-- Owner-selected image references, prices, stock and sales are never overwritten.
with photos(catalogue_name, slug) as (
  values
    ('Heineken', 'heineken-big-60cl'),
    ('Castle Lite', 'castle-lite-60cl'),
    ('Flying Fish', 'flying-fish-45cl'),
    ('Trophy Stout', 'trophy-stout-60cl'),
    ('Tiger', 'tiger-45cl-closecrop')
), updated as (
  update public.product_catalogue as c
  set image_path='first-party/' || photos.slug || '.webp'
  from photos
  where c.name=photos.catalogue_name and c.image_path is null
  returning c.id, c.image_path
)
update public.products as p
set image_url='/catalogue-photos/' || substring(updated.image_path from 13)
from updated
where p.catalogue_product_id=updated.id and p.image_url is null;

commit;
