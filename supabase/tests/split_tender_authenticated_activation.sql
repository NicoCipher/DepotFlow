-- Pre-activation contract test. All operations run against disposable Postgres.
-- Temporarily grant RPC only inside this test's rolled-back transaction.
-- This proves a real authenticated Supabase role can record/recover Cash+Transfer
-- before permission is ever enabled against live customer records.
begin;

create function pg_temp.assert_true(v boolean, msg text)
returns void language plpgsql as $$
begin if v is distinct from true then raise exception '%', msg; end if; end $$;

-- The application must remain disabled by default.
select pg_temp.assert_true(not has_function_privilege('authenticated',
 'public.save_sale_split_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)', 'EXECUTE'),
 'Split tender RPC unexpectedly enabled before the activation switch');

insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000009811'),
 ('00000000-0000-4000-8000-000000009812');
insert into private.shop_owner(user_id)
 values ('00000000-0000-4000-8000-000000009811');
insert into public.crate_types(id,name,empty_family,pocket_count)
 values ('50000000-0000-4000-8000-000000009811','Activation Test 12','Test',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottle_price,bottles_returnable,crate_type_id)
 values ('10000000-0000-4000-8000-000000009811','Authenticated Split Test',12,20400,1700,false,
         '50000000-0000-4000-8000-000000009811');
insert into public.stock(product_id,total_bottles)
 values ('10000000-0000-4000-8000-000000009811',100);
insert into public.customers(id,name,phone)
 values ('20000000-0000-4000-8000-000000009811','Simulated Split Buyer','08000009811');
insert into public.money_owed(customer_id,amount)
 values ('20000000-0000-4000-8000-000000009811',2000);

create function pg_temp.lines() returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object(
   'productId','10000000-0000-4000-8000-000000009811',
   'quantity',jsonb_build_object('crates',0,'fraction',0,'bottles',1),
   'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
   'expected',jsonb_build_object('full',20400,'half',null,'quarter',null,
     'bottle',1700,'size',12,'crate','50000000-0000-4000-8000-000000009811',
     'returnable',false,'bottleType',null)
 ));
$$;
create function pg_temp.legs(a integer,b integer,c integer,d integer)
returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('method','cash','saleAmount',a,'oldDebtAmount',b,'amount',a+b),
  jsonb_build_object('method','transfer','saleAmount',c,'oldDebtAmount',d,'amount',c+d)
 );
$$;

-- This is the *same* grant and role that a final activation would provide,
-- scoped only to the disposable SQL test transaction.
grant execute on function public.save_sale_split_tender(
 uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) to authenticated;
select pg_temp.assert_true(has_function_privilege('authenticated',
 'public.save_sale_split_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)', 'EXECUTE'),
 'Temporary authenticated grant did not apply');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009811',true);

-- First actual authenticated call: full ₦1,700 sale, ₦700 cash + ₦1,000 transfer.
do $$ declare v jsonb; v_retry jsonb; v_id uuid; begin
 v := public.save_sale_split_tender(
  '40000000-0000-4000-8000-000000009811',
  '20000000-0000-4000-8000-000000009811','2026-10-16',
  1700,pg_temp.lines(),'[]','[]',0,pg_temp.legs(700,0,1000,0));
 v_id := (v->>'id')::uuid;
 perform pg_temp.assert_true((v->>'total')::int=1700 and
  (v->>'paid')::int=1700 and (v->>'oldDebtPaid')::int=0,
  'Authenticated RPC returned an incorrect sale');
 perform pg_temp.assert_true((select payment_method='mixed' and paid_amount=1700
   from public.sales where id=v_id),'Saved sale did not record a mixed method');
 perform pg_temp.assert_true((select count(*)=2 and sum(sale_amount)=1700 and
    sum(old_debt_amount)=0 from public.sale_tender_legs where sale_id=v_id),
    'Authenticated saver did not record exactly two tender legs');
 perform pg_temp.assert_true((select
    jsonb_array_length(public.verify_receipt(verification_token)->'tenders')=2
    and (select sum((l->>'amount')::int)
      from jsonb_array_elements(public.verify_receipt(verification_token)->'tenders') l)=1700
    from public.sales where id=v_id),'Public receipt did not show both actual tender amounts');
 perform pg_temp.assert_true((select total_bottles=99 from public.stock
    where product_id='10000000-0000-4000-8000-000000009811'),
    'Authenticated split did not deduct one bottle');
 v_retry := public.save_sale_split_tender(
  '40000000-0000-4000-8000-000000009811',
  '20000000-0000-4000-8000-000000009811','2026-10-16',
  1700,pg_temp.lines(),'[]','[]',0,pg_temp.legs(700,0,1000,0));
 perform pg_temp.assert_true(v_retry->>'id'=v->>'id',
   'Original request replay did not return the original sale');
 perform pg_temp.assert_true((select count(*)=1 from public.sales where
   request_id='40000000-0000-4000-8000-000000009811'),
   'Idempotent request created two sales');
 perform pg_temp.assert_true((select total_bottles=99 from public.stock
   where product_id='10000000-0000-4000-8000-000000009811'),
   'Idempotent request deducted inventory twice');
end $$;

-- Authenticated old-debt payment: ₦1,200 toward a ₦1,700 new sale and
-- ₦500 toward previous debt, with both payment methods allocated explicitly.
do $$ declare v jsonb; v_id uuid; begin
 v := public.save_sale_split_tender(
  '40000000-0000-4000-8000-000000009812',
  '20000000-0000-4000-8000-000000009811','2026-10-16',
  1200,pg_temp.lines(),'[]','[]',500,pg_temp.legs(500,200,700,300));
 v_id := (v->>'id')::uuid;
 perform pg_temp.assert_true((v->>'oldDebtPaid')::int=500 and
   (v->>'balanceAfter')::int=2000,'Customer closing debt is incorrect');
 perform pg_temp.assert_true((select count(*)=2 and
    sum(sale_amount)=1200 and sum(old_debt_amount)=500
    from public.sale_tender_legs where sale_id=v_id),
    'Split old-debt allocations were not stored correctly');
 perform pg_temp.assert_true((select method='mixed' and amount=500 and
    jsonb_array_length(public.verify_receipt(verification_token)->'tenders')=2
    and (select sum((l->>'oldDebtAmount')::int) from
         jsonb_array_elements(public.verify_receipt(verification_token)->'tenders') l)=500
    from public.customer_payments where
      request_id=md5('depotflow:old-debt:' || '40000000-0000-4000-8000-000000009812')::uuid),
    'Old-debt receipt did not report real cash + transfer allocations');
 perform pg_temp.assert_true((select amount=2000 from public.money_owed where
   customer_id='20000000-0000-4000-8000-000000009811'),
   'Customer live debt differs from frozen historical receipt');
end $$;

-- A wrongly split amount or a different idempotent replay must fail
-- *without* leaving a sale, receipt or stock change.
do $$ begin
 begin
  perform public.save_sale_split_tender(
   '40000000-0000-4000-8000-000000009813',
   '20000000-0000-4000-8000-000000009811','2026-10-16',
   1700,pg_temp.lines(),'[]','[]',0,pg_temp.legs(700,0,900,0));
  raise exception 'Short split was accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_sale_split_tender(
   '40000000-0000-4000-8000-000000009811',
   '20000000-0000-4000-8000-000000009811','2026-10-16',
   1700,pg_temp.lines(),'[]','[]',0,pg_temp.legs(800,0,900,0));
  raise exception 'Changed same-request split was accepted';
 exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.assert_true(not exists(select 1 from public.sales where
 request_id='40000000-0000-4000-8000-000000009813'),
 'Rejected split left a sale in the database');
select pg_temp.assert_true((select total_bottles=98 from public.stock where
 product_id='10000000-0000-4000-8000-000000009811'),
 'Rejected split modified stock');

-- Non-owner authenticated role must not write, even with the RPC grant.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009812',true);
do $$ begin
 begin
  perform public.save_sale_split_tender(
   '40000000-0000-4000-8000-000000009814',
   '20000000-0000-4000-8000-000000009811','2026-10-16',
   1700,pg_temp.lines(),'[]','[]',0,pg_temp.legs(700,0,1000,0));
  raise exception 'Non-owner saved a split payment';
 exception when insufficient_privilege then null; end;
end $$;

-- No temporary grants or test business data may survive rollback.
rollback;
