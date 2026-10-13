begin;

-- Restore the existing Goldberg 60cl first-party photo without changing owner-selected images.
-- The master catalogue uses a unique Goldberg identity across deployments.
with saved_catalogue as (
  update public.product_catalogue
  set image_path = 'first-party/goldberg-60cl.webp'
  where name = 'Goldberg'
    and image_path is null
  returning id
)
update public.products as p
set image_url = '/catalogue-photos/goldberg-60cl.webp'
from saved_catalogue as c
where p.catalogue_product_id = c.id
  and p.image_url is null;

commit;
