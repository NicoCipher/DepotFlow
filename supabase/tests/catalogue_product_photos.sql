-- All photo references are managed by the shop owner and updated transactionally.
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
 v_url text;
 v_saved boolean;
begin
 select id into v_id from public.product_catalogue where name = 'Goldberg';
 v_path := 'catalogue/' || v_id::text || '/11111111-1111-4111-8111-111111111111.webp';
 v_url := 'https://test.supabase.co/storage/v1/object/public/product-images/' || v_path;

 select public.set_catalogue_product_image(v_id, null, v_path, v_url) into v_saved;
 if v_saved is distinct from true then raise exception 'Owner upload rejected'; end if;
 if (select image_path from public.product_catalogue where id = v_id) is distinct from v_path
 then raise exception 'Catalogue photo path not committed'; end if;

 select public.set_catalogue_product_image(v_id, null,
   'catalogue/' || v_id::text || '/22222222-2222-4222-8222-222222222222.png',
   'https://test.supabase.co/storage/v1/object/public/product-images/catalogue/' ||
       v_id::text || '/22222222-2222-4222-8222-222222222222.png') into v_saved;
 if v_saved is not false then raise exception 'Stale overwrite was accepted'; end if;
 if (select image_path from public.product_catalogue where id = v_id) is distinct from v_path
 then raise exception 'Stale overwrite changed image'; end if;

 begin
   perform public.set_catalogue_product_image(
     v_id, v_path, v_path,
     'https://untrusted.example/image.png'
   );
   raise exception 'Remote image URL was accepted';
 exception when invalid_parameter_value then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000062',true);

do $$
declare v_id uuid; v_saved boolean;
begin
 select id into v_id from public.product_catalogue where name = 'Goldberg';
 -- A non-owner has no read access to this catalogue row.
 if v_id is not null then raise exception 'Non-owner can read catalogue'; end if;
 -- Refer to a public known UUID from the fixture by privileged caller? No:
 -- A fabricated one must never be inserted or changed.
 select public.set_catalogue_product_image(
  '11111111-1111-4111-8111-111111111111', null,
  'catalogue/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp',
  'https://test.supabase.co/storage/v1/object/public/product-images/catalogue/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp'
 ) into v_saved;
 if v_saved is not false then raise exception 'Non-owner modified catalogue'; end if;
end;
$$;

rollback;
