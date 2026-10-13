begin;

-- Genuine bottle photographs verified and stored first-party for 15 configured shop drinks.
-- Never overwrite an owner's previously chosen image or alter any sale, price, or stock.
-- Source and rights record: docs/shop-photo-source-manifest.json.
with chosen(catalogue_name, photo_slug) as (
  values
    ('33', '33-export-60cl'),
    ('Amstel', 'amstel-malta-33cl'),
    ('Big Stout', 'guinness-stout-big-60cl'),
    ('Budweiser', 'budweiser-60cl'),
    ('Desperados', 'desperados-45cl'),
    ('Gulder', 'gulder-60cl'),
    ('Legend', 'legend-60cl'),
    ('Life', 'life-60cl'),
    ('Malta', 'malta-guinness-33cl'),
    ('Small Stout', 'guinness-stout-small-33cl'),
    ('Small Ice', 'smirnoff-ice-small-33cl'),
    ('Star', 'star-60cl'),
    ('Radler', 'star-radler-citrus-45cl'),
    ('Tiger', 'tiger-45cl'),
    ('Trophy', 'trophy-lager-60cl')
),
linked_catalogue as (
  update public.product_catalogue as c
  set image_path = 'first-party/' || chosen.photo_slug || '.webp'
  from chosen
  where c.name = chosen.catalogue_name and c.image_path is null
  returning c.id, c.image_path
)
update public.products as p
set image_url = '/catalogue-photos/' || substring(linked_catalogue.image_path from 13)
from linked_catalogue
where p.catalogue_product_id = linked_catalogue.id and p.image_url is null;

commit;
