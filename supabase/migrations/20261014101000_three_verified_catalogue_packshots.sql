begin;

-- Real white-background product photos, independently inspected for three
-- exact catalogue identities. Master catalogue does not depend on stock.
-- Do not overwrite owner-selected photo paths and do not touch business data.
with selected(catalogue_name,manufacturer,slug) as (
  values
    ('Turbo','NB','turbo-king-bottle-60cl'),
    ('Malta Can','GN','malta-guinness-can-original-33cl'),
    ('Stout Can','GN','guinness-fes-can-33cl')
), updated as (
  update public.product_catalogue as c
  set image_path='first-party/' || selected.slug || '.webp'
  from selected
  where c.name=selected.catalogue_name
    and c.manufacturer=selected.manufacturer
    and c.image_path is null
  returning c.id, c.image_path
)
update public.products as p
set image_url='/catalogue-photos/' || substring(updated.image_path from 13)
from updated
where p.catalogue_product_id=updated.id and p.image_url is null;

commit;
