begin;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000061'),
 ('00000000-0000-4000-8000-000000000062');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000061');
insert into public.crate_types(id,name,empty_family,pocket_count)
values ('10000000-0000-4000-8000-000000000061','Setup test crate','NB',12);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000061',true);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,catalogue_product_id)
select '20000000-0000-4000-8000-000000000061','My Goldberg',12,10000,false,
 '10000000-0000-4000-8000-000000000061',id from public.product_catalogue where name='Goldberg';
do $$ begin
 if not exists(select 1 from public.products p join public.product_catalogue c on c.id=p.catalogue_product_id
   where p.name='My Goldberg' and c.name='Goldberg' and p.full_crate_price=10000) then
   raise exception 'Catalogue product setup did not preserve identity and editable details';
 end if;
 if exists(select 1 from public.stock) then raise exception 'Setup invented stock'; end if;
 begin
   insert into public.products(name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,catalogue_product_id)
   select 'Duplicate Goldberg',12,10000,false,'10000000-0000-4000-8000-000000000061',id
   from public.product_catalogue where name='Goldberg';
   raise exception 'Duplicate catalogue product accepted';
 exception when unique_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000062',true);
do $$ begin
 begin
   insert into public.products(name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,catalogue_product_id)
   values ('Not owner',12,10000,false,'10000000-0000-4000-8000-000000000061',null);
   raise exception 'Non-owner created product';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
