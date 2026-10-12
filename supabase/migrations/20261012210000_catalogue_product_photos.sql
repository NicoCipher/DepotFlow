begin;

-- A catalogue photo is a Storage object reference, not a database binary or remote URL.
alter table public.product_catalogue add column if not exists image_path text;

alter table public.product_catalogue add constraint product_catalogue_image_path_shape
check (image_path is null or image_path ~*
  '^catalogue/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(webp|png|jpg|jpeg)$'
);

grant update (image_path) on public.product_catalogue to authenticated;
create policy owner_update_catalogue_image on public.product_catalogue
  for update to authenticated
  using ((select public.is_shop_owner()))
  with check ((select public.is_shop_owner()));

-- Catalogue and configured product updates are atomic, under the caller's RLS.
create function public.set_catalogue_product_image(
  p_catalogue_id uuid, p_expected_path text, p_new_path text, p_new_url text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  updated_count integer;
begin
  if p_new_path is null
     or p_new_path !~* ('^catalogue/' || p_catalogue_id::text ||
        '/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(webp|png|jpg|jpeg)$')
     or p_new_url is null
     or p_new_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/product-images/'
     or right(p_new_url, length(p_new_path)) <> p_new_path
     or position('?' in p_new_url) <> 0
     or position('#' in p_new_url) <> 0
  then
    raise exception 'Invalid managed product photo' using errcode = '22023';
  end if;

  update public.product_catalogue set image_path = p_new_path
  where id = p_catalogue_id and image_path is not distinct from p_expected_path;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then return false; end if;
  update public.products set image_url = p_new_url
  where catalogue_product_id = p_catalogue_id;
  return true;
end;
$$;

revoke all on function public.set_catalogue_product_image(uuid,text,text,text) from public, anon;
grant execute on function public.set_catalogue_product_image(uuid,text,text,text) to authenticated;
commit;
