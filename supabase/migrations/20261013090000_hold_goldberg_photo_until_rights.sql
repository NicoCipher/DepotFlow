begin;

-- Do not distribute a third-party photograph before the owner's reuse rights are verified.
-- Conditional reversal: preserve any image independently changed by the shop owner.
update public.product_catalogue
set image_path = null
where name = 'Goldberg'
  and image_path = 'first-party/goldberg-60cl.webp';

update public.products as p
set image_url = null
where p.image_url = '/catalogue-photos/goldberg-60cl.webp'
  and exists (
    select 1 from public.product_catalogue pc
    where pc.id = p.catalogue_product_id and pc.name = 'Goldberg'
  );

commit;
