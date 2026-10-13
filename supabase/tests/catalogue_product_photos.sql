-- Owner-only catalogue photo updates with concurrency checks. Rollback fixtures.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000061'),
  ('00000000-0000-4000-8000-000000000062');
insert into private.shop_owner(user_id)
values ('00000000-0000-4000-8000-000000000061');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000061',true);

do $$
declare
  v_id uuid;
  v_path text;
  v_previous text;
  v_url text;
  v_saved boolean;
begin
  select id,image_path into v_id,v_previous from public.product_catalogue where name = 'Goldberg';
  if v_id is null then raise exception 'Owner could not read Goldberg'; end if;
  v_path := 'catalogue/' || v_id::text || '/11111111-1111-4111-8111-111111111111.webp';
  v_url := 'https://test.supabase.co/storage/v1/object/public/product-images/' || v_path;
  raise notice 'Photo predicate diagnostics: path %, url %, suffix %',
    v_path ~* ('^catalogue/' || v_id::text ||
      '/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(webp|png|jpg|jpeg)$'),
    v_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/product-images/',
    right(v_url,length(v_path))=v_path;
  select public.set_catalogue_product_image(v_id,v_previous,v_path,v_url) into v_saved;
  if v_saved is distinct from true then raise exception 'Owner upload rejected'; end if;
  if (select image_path from public.product_catalogue where id=v_id) is distinct from v_path
    then raise exception 'Photo path not committed'; end if;

  select public.set_catalogue_product_image(v_id,null,
   'catalogue/'||v_id::text||'/22222222-2222-4222-8222-222222222222.png',
   'https://test.supabase.co/storage/v1/object/public/product-images/catalogue/' ||
     v_id::text || '/22222222-2222-4222-8222-222222222222.png') into v_saved;
  if v_saved is not false then raise exception 'Stale photo update accepted'; end if;
  if (select image_path from public.product_catalogue where id=v_id) is distinct from v_path
    then raise exception 'Stale update overwrote path'; end if;

  begin
    perform public.set_catalogue_product_image(v_id,v_path,v_path,'https://evil.example/image.png');
    raise exception 'Remote URL accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000062',true);
do $$
declare v_ok boolean;
begin
  select public.set_catalogue_product_image(
    '11111111-1111-4111-8111-111111111111', null,
    'catalogue/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp',
    'https://test.supabase.co/storage/v1/object/public/product-images/catalogue/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp'
  ) into v_ok;
  if v_ok is not false then raise exception 'Nonowner updated catalogue'; end if;
end;
$$;
rollback;
