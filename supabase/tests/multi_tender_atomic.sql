-- Multi-method POS extension: disposable migrated PostgreSQL only.
-- No live shop writes, and the new RPC stays ungranted to authenticated.
begin;

create function pg_temp.ok(v boolean, m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception '%', m; end if; end $$;

select pg_temp.ok(not has_function_privilege('authenticated',
 'public.save_sale_multi_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)', 'EXECUTE'),
 'New POS multi-tender saver must stay disabled pending release approval');
select pg_temp.ok(not has_function_privilege('anon',
 'public.save_sale_multi_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)', 'EXECUTE'),
 'Anonymous users must never call the POS multi-tender saver');

insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000009931'),
 ('00000000-0000-4000-8000-000000009932');
insert into private.shop_owner(user_id)
 values ('00000000-0000-4000-8000-000000009931');
insert into public.crate_types(id,name,empty_family,pocket_count)
 values ('50000000-0000-4000-8000-000000009931','Multi Test 12','Test',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottle_price,bottles_returnable,crate_type_id)
 values ('10000000-0000-4000-8000-000000009931','Multi Test Drink',12,20400,1700,false,
         '50000000-0000-4000-8000-000000009931');
insert into public.stock(product_id,total_bottles)
 values ('10000000-0000-4000-8000-000000009931',100);
insert into public.customers(id,name,phone)
 values ('20000000-0000-4000-8000-000000009931','Multi Test Buyer','08000009931');
insert into public.money_owed(customer_id,amount)
 values ('20000000-0000-4000-8000-000000009931',2200);

create function pg_temp.lines() returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object(
  'productId','10000000-0000-4000-8000-000000009931',
  'quantity',jsonb_build_object('crates',0,'fraction',0,'bottles',1),
  'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
  'expected',jsonb_build_object('full',20400,'half',null,'quarter',null,
    'bottle',1700,'size',12,'crate','50000000-0000-4000-8000-000000009931',
    'returnable',false,'bottleType',null)
 ));
$$;

create function pg_temp.cash_pos() returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('method','cash','saleAmount',700,'oldDebtAmount',0,'amount',700),
  jsonb_build_object('method','pos','saleAmount',1000,'oldDebtAmount',0,'amount',1000)
 );
$$;
create function pg_temp.transfer_pos() returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('method','transfer','saleAmount',1000,'oldDebtAmount',0,'amount',1000),
  jsonb_build_object('method','pos','saleAmount',700,'oldDebtAmount',0,'amount',700)
 );
$$;
create function pg_temp.all_three() returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('method','cash','saleAmount',700,'oldDebtAmount',0,'amount',700),
  jsonb_build_object('method','transfer','saleAmount',0,'oldDebtAmount',2200,'amount',2200),
  jsonb_build_object('method','pos','saleAmount',1000,'oldDebtAmount',0,'amount',1000)
 );
$$;

set local role postgres;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009931',true);

-- Cash + POS can pay a whole sale, and old debt remains untouched.
do $$ declare v jsonb; v_retry jsonb; begin
 v := public.save_sale_multi_tender(
  '40000000-0000-4000-8000-000000009931',
  '20000000-0000-4000-8000-000000009931','2026-10-17',
  1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_pos());
 perform pg_temp.ok((v->>'paid')::int=1700 and (v->>'oldDebtPaid')::int=0,
   'Cash + POS sale totals incorrect');
 perform pg_temp.ok((select count(*)=2 and sum(sale_amount)=1700 and
    sum(old_debt_amount)=0 and count(*) filter (where method='pos')=1
    from public.sale_tender_legs where sale_id=(v->>'id')::uuid),
   'Cash + POS legs missing');
 perform pg_temp.ok((select
    jsonb_array_length(public.verify_receipt(verification_token)->'tenders')=2
    and (select sum((leg->>'amount')::int)
      from jsonb_array_elements(public.verify_receipt(verification_token)->'tenders') leg)=1700
    from public.sales where id=(v->>'id')::uuid),
   'Public verified receipt did not show POS');
 v_retry := public.save_sale_multi_tender(
  '40000000-0000-4000-8000-000000009931',
  '20000000-0000-4000-8000-000000009931','2026-10-17',
  1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_pos());
 perform pg_temp.ok(v_retry->>'id'=v->>'id', 'Same multi request was not idempotent');
 perform pg_temp.ok((select count(*)=1 from public.sales where
    request_id='40000000-0000-4000-8000-000000009931'),
    'Replay created duplicate sale');
end $$;

-- Transfer + POS (no Cash) is valid.
do $$ declare v jsonb; begin
 v := public.save_sale_multi_tender(
  '40000000-0000-4000-8000-000000009932',
  '20000000-0000-4000-8000-000000009931','2026-10-17',
  1700,pg_temp.lines(),'[]','[]',0,pg_temp.transfer_pos());
 perform pg_temp.ok((select count(*)=2 and
    count(*) filter (where method='transfer')=1 and
    count(*) filter (where method='pos')=1
    from public.sale_tender_legs where sale_id=(v->>'id')::uuid),
    'Transfer + POS combination missing');
end $$;

-- Three methods can split the sale and a PREVIOUS debt without conflating
-- the purpose of the Transfer amount. Old-debt receipt correctly says Transfer.
do $$ declare v jsonb; begin
 v := public.save_sale_multi_tender(
  '40000000-0000-4000-8000-000000009933',
  '20000000-0000-4000-8000-000000009931','2026-10-17',
  1700,pg_temp.lines(),'[]','[]',2200,pg_temp.all_three());
 perform pg_temp.ok((select count(*)=3 and sum(sale_amount)=1700
   and sum(old_debt_amount)=2200 from public.sale_tender_legs
   where sale_id=(v->>'id')::uuid),'Three-leg amounts not atomic');
 perform pg_temp.ok((select method='transfer' and amount=2200 from public.customer_payments
   where request_id=md5('depotflow:old-debt:' ||
     '40000000-0000-4000-8000-000000009933')::uuid),
   'Old-debt receipt must identify Transfer, not mixed');
 perform pg_temp.ok((select
   jsonb_array_length(public.verify_receipt(verification_token)->'tenders')=3
   from public.sales where id=(v->>'id')::uuid),
   'Public sale receipt must verify all three methods');
 perform pg_temp.ok((select total_bottles=97 from public.stock where
   product_id='10000000-0000-4000-8000-000000009931'),
   'Three sales must deduct three bottles exactly');
end $$;

-- Incorrect totals, duplicate methods and replay mutation must not save.
do $$ begin
 begin
  perform public.save_sale_multi_tender(
   '40000000-0000-4000-8000-000000009934',
   '20000000-0000-4000-8000-000000009931','2026-10-17',
   1700,pg_temp.lines(),'[]','[]',0,
   '[{"method":"cash","saleAmount":700,"oldDebtAmount":0,"amount":700},{"method":"pos","saleAmount":900,"oldDebtAmount":0,"amount":900}]'::jsonb);
  raise exception 'Incorrect combined amount was accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_sale_multi_tender(
   '40000000-0000-4000-8000-000000009935',
   '20000000-0000-4000-8000-000000009931','2026-10-17',
   1700,pg_temp.lines(),'[]','[]',0,
   '[{"method":"cash","saleAmount":700,"oldDebtAmount":0,"amount":700},{"method":"cash","saleAmount":1000,"oldDebtAmount":0,"amount":1000}]'::jsonb);
  raise exception 'Duplicate method was accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_sale_multi_tender(
   '40000000-0000-4000-8000-000000009931',
   '20000000-0000-4000-8000-000000009931','2026-10-17',
   1700,pg_temp.lines(),'[]','[]',0,pg_temp.transfer_pos());
  raise exception 'Changed same-request payment methods were accepted';
 exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.ok(not exists(select 1 from public.sales where
 request_id in ('40000000-0000-4000-8000-000000009934',
                '40000000-0000-4000-8000-000000009935')),
 'Failed multi save left a sale');
select pg_temp.ok((select total_bottles=97 from public.stock
 where product_id='10000000-0000-4000-8000-000000009931'),
 'Rejected multi write changed stock');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009932',true);
do $$ begin
 begin
  perform public.save_sale_multi_tender(
   '40000000-0000-4000-8000-000000009936',
   '20000000-0000-4000-8000-000000009931','2026-10-17',
   1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_pos());
  raise exception 'Non-owner recorded POS split';
 exception when insufficient_privilege then null; end;
end $$;

rollback;
