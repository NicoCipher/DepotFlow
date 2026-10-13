begin;

-- Restore the original, optimised Goldberg 60cl bottle file for the owner-requested pilot.
-- Never overwrite an owner-selected image. Only fill the exact linked shop product
-- when its own image is also unset.
with saved_catalogue as (
  update public.product_catalogue
  set image_path = 'first-party/goldberg-60cl.webp'
  where id = 'a5a88718-5fb3-488f-aea4-5271e535607e'
    and name = 'Goldberg'
    and image_path is null
  returning id
)
update public.products as p
set image_url = '/catalogue-photos/goldberg-60cl.webp'
from saved_catalogue as c
where p.catalogue_product_id = c.id
  and p.image_url is null;

commit;
