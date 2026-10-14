begin;
-- Genuine photographs for two master catalogue products not yet configured by any shop.
-- Images remain independent of stock levels, owner-selected photos stay untouched.
with images(catalogue_name,slug) as (
  values
    ('Maltina','maltina-classic-glass-33cl'),
    ('Maltina Can','maltina-classic-can-33cl')
)
update public.product_catalogue as c
set image_path='first-party/' || images.slug || '.webp'
from images
where c.name=images.catalogue_name and c.image_path is null;
commit;
