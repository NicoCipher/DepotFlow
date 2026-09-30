-- Disposable PostgreSQL only; changes roll back.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000061'),
  ('00000000-0000-4000-8000-000000000062');
insert into private.shop_owner(user_id) values
  ('00000000-0000-4000-8000-000000000061');
do $$ begin
  if (select count(*) from public.product_selling_price_history
      where source='confirmed_list') <> 25 or not exists (
    select 1 from public.product_selling_price_history h
    join public.product_catalogue c on c.id=h.catalogue_product_id
    where c.name='Trophy Stout' and h.selling_price=11600
      and h.effective_on=date '2026-09-29'
  ) then raise exception 'Owner provisioning did not seed confirmed prices'; end if;
end $$;
update private.shop_owner set user_id=user_id;
do $$ begin
  if (select count(*) from public.product_selling_price_history) <> 25 then
    raise exception 'Owner provisioning duplicated confirmed prices';
  end if;
end $$;
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
  if (select count(*) from public.product_selling_price_history where source='product_edit') <> 2
    or not exists(select 1 from public.product_selling_price_history
      where selling_price=10100 and source='product_edit')
    or not exists(select 1 from public.product_selling_price_history
      where selling_price=10200 and source='product_edit') then
    raise exception 'Configured edits did not append selling-price history';
  end if;
  if (select selling_price from public.product_selling_price_history
      order by effective_on desc,recorded_at desc,edit_order desc limit 1) <> 10200 then
    raise exception 'Latest same-transaction edit selected an earlier price';
  end if;
  begin
    update public.product_selling_price_history set selling_price=1;
    raise exception 'History was directly editable';
  exception when insufficient_privilege then null; end;
end $$;
update public.products set full_crate_price=0
where id='60000000-0000-4000-8000-000000000061';
do $$ begin
  if (select selling_price from public.product_selling_price_history
      where source='product_edit'
      order by effective_on desc,recorded_at desc,edit_order desc limit 1)
      is distinct from 0 then
    raise exception 'Supported zero-price edit was not recorded';
  end if;
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
