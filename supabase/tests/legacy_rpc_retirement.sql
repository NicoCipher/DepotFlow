begin;
do $$ begin
  if to_regprocedure('public.record_payment(uuid,uuid,numeric,date)') is not null
    or to_regprocedure('public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb)') is not null
    or to_regprocedure('public.save_sale(uuid,uuid,date,numeric,jsonb)') is not null
    or to_regprocedure('private.save_sale(uuid,uuid,date,numeric,jsonb)') is not null then
    raise exception 'An obsolete sale or payment RPC is still installed';
  end if;
  if to_regprocedure('public.record_payment(uuid,uuid,numeric,date,text)') is null
    or to_regprocedure('public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text)') is null then
    raise exception 'A supported sale or payment RPC was removed';
  end if;
end $$;

-- Exercise the supported save path after the old implementation is dropped.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000081');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000081');
insert into public.crate_types(id,name,empty_family,pocket_count) values
  ('50000000-0000-4000-8000-000000000081','Test crate','NB',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,bottle_type,crate_type_id)
values ('10000000-0000-4000-8000-000000000081','Test drink',12,12000,true,'Test bottle',
  '50000000-0000-4000-8000-000000000081');
insert into public.stock(product_id,total_bottles) values
  ('10000000-0000-4000-8000-000000000081',24);
insert into public.customers(id,name,phone) values
  ('20000000-0000-4000-8000-000000000081','Test customer','08000000081');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
do $$
declare v_line jsonb; v_first jsonb; v_again jsonb;
begin
  v_line := jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000081',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',1,'returnedCrates',1,'returnedBottles',12,
    'expected',jsonb_build_object('full',12000,'half',null,'quarter',null,
      'bottle',null,'size',12,'crate','50000000-0000-4000-8000-000000000081',
      'returnable',true,'bottleType','Test bottle','stock',24));
  v_first := public.save_sale_v2('40000000-0000-4000-8000-000000000081',
    '20000000-0000-4000-8000-000000000081','2026-09-29',12000,
    jsonb_build_array(v_line),
    '[{"crateTypeId":"50000000-0000-4000-8000-000000000081","quantity":1}]'::jsonb,
    '[{"bottleType":"Test bottle","quantity":12}]'::jsonb,'cash');
  v_again := public.save_sale_v2('40000000-0000-4000-8000-000000000081',
    '20000000-0000-4000-8000-000000000081','2026-09-29',12000,
    jsonb_build_array(v_line),
    '[{"crateTypeId":"50000000-0000-4000-8000-000000000081","quantity":1}]'::jsonb,
    '[{"bottleType":"Test bottle","quantity":12}]'::jsonb,'cash');
  if v_first->>'id' is distinct from v_again->>'id'
    or (select total_bottles from public.stock where product_id='10000000-0000-4000-8000-000000000081') <> 12
    or (select count(*) from public.sales where request_id='40000000-0000-4000-8000-000000000081') <> 1
    or (select payment_method from public.sales where request_id='40000000-0000-4000-8000-000000000081') <> 'cash' then
    raise exception 'Current sale save or idempotent retry failed after legacy retirement';
  end if;
end $$;
rollback;
