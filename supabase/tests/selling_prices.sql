-- Disposable PostgreSQL only; changes roll back.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000061'),
  ('00000000-0000-4000-8000-000000000062');
insert into private.shop_owner(user_id) values
  ('00000000-0000-4000-8000-000000000061');
insert into public.crate_types(id,name,empty_family,pocket_count) values
  ('50000000-0000-4000-8000-000000000061','Test crate','NB',12);
insert into public.products
  (id,name,bottles_per_crate,full_crate_price,bottles_returnable,
   crate_type_id,catalogue_product_id)
select '60000000-0000-4000-8000-000000000061','Test 33',12,10000,false,
  '50000000-0000-4000-8000-000000000061',id
from public.product_catalogue where name='33';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000061',true);
update public.products set full_crate_price=10100
where id='60000000-0000-4000-8000-000000000061';
update public.products set full_crate_price=10200
where id='60000000-0000-4000-8000-000000000061';
do $$ begin
  if (select count(*) from public.product_selling_price_history) <> 2
    or not exists(select 1 from public.product_selling_price_history
      where selling_price=10100 and source='product_edit')
    or not exists(select 1 from public.product_selling_price_history
      where selling_price=10200 and source='product_edit') then
    raise exception 'Configured edits did not append selling-price history';
  end if;
  begin
    update public.product_selling_price_history set selling_price=1;
    raise exception 'History was directly editable';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000062',true);
do $$ begin
  if exists(select 1 from public.product_selling_price_history) then
    raise exception 'Another user can read this depot selling prices';
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.product_selling_price_history;
    raise exception 'Anonymous selling-price access allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
