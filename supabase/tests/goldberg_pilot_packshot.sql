-- Verify Goldberg first-party reference and shop propagation when an assortment exists.
-- This test also works in fresh disposable databases with no configured shop rows.
begin;
do $$
declare
  v_catalogue_id uuid;
  v_catalogue_image text;
begin
  select id,image_path into strict v_catalogue_id,v_catalogue_image
  from public.product_catalogue where name = 'Goldberg';

  if v_catalogue_image is distinct from 'first-party/goldberg-60cl.webp' then
    raise exception 'Goldberg catalogue image missing: %', v_catalogue_image;
  end if;

  if exists (
    select 1 from public.products
    where catalogue_product_id = v_catalogue_id
      and image_url is null
  ) then
    raise exception 'Linked Goldberg shop image was not populated';
  end if;
end;
$$;
rollback;
