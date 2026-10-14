begin;
-- One real verified Big Smirnoff Ice 60cl packshot for owner-requested pilot.
-- Only fill unset records; do not modify pricing, stock, sales or other images.
with updated as (
  update public.product_catalogue
  set image_path='first-party/smirnoff-ice-big-60cl.webp'
  where name='Big Ice' and image_path is null
  returning id
)
update public.products as p
set image_url='/catalogue-photos/smirnoff-ice-big-60cl.webp'
from updated
where p.catalogue_product_id=updated.id
  and p.image_url is null;
commit;
