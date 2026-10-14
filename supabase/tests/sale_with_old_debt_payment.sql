-- Run against a disposable migrated database. Nothing persists.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000008701'),
  ('00000000-0000-4000-8000-000000008702');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000008701');
insert into public.crate_types(id,name,empty_family,pocket_count)
values ('50000000-0000-4000-8000-000000008701','Debt Test 12','Test',12);
insert into public.products(
  id,name,bottles_per_crate,full_crate_price,bottle_price,
  bottles_returnable,crate_type_id
) values (
  '10000000-0000-4000-8000-000000008701','Old Debt Test Drink',12,12000,1000,
  false,'50000000-0000-4000-8000-000000008701'
);
insert into public.stock(product_id,total_bottles)
values ('10000000-0000-4000-8000-000000008701',100);
insert into public.customers(id,name,phone)
values ('20000000-0000-4000-8000-000000008701','Old Debt Test','08000008701');
insert into public.money_owed(customer_id,amount)
values ('20000000-0000-4000-8000-000000008701',5000);

create function pg_temp.ok(v boolean,msg text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception '%',msg; end if; end $$;
create function pg_temp.lines() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000008701',
    'quantity',jsonb_build_object('crates',0,'fraction',0,'bottles',1),
    'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
    'expected',jsonb_build_object('full',12000,'half',null,'quarter',null,
      'bottle',1000,'size',12,'crate','50000000-0000-4000-8000-000000008701',
      'returnable',false,'bottleType',null)
  ));
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000008701',true);

do $$ declare v jsonb; begin
  v := public.save_sale_with_old_debt_payment(
    '40000000-0000-4000-8000-000000008701',
    '20000000-0000-4000-8000-000000008701','2026-10-14',
    500,pg_temp.lines(),'[]','[]','cash',2000
  );
  perform pg_temp.ok((v->>'total')::int=1000 and (v->>'paid')::int=500,
    'Today''s sale total or paid is wrong');
  perform pg_temp.ok((v->>'oldDebtPaid')::int=2000 and (v->>'balanceAfter')::int=3500,
    'Old debt and new unpaid sale were not combined correctly');
  perform pg_temp.ok((select amount=3500 from public.money_owed
    where customer_id='20000000-0000-4000-8000-000000008701'),'Wrong final customer debt');
  perform pg_temp.ok((select count(*)=1 from public.customer_payments
    where customer_id='20000000-0000-4000-8000-000000008701'),'No separate payment ledger');
  perform pg_temp.ok((select amount=2000 and owed_after=3000 and method='cash'
    from public.customer_payments where request_id=(v->>'oldDebtReceiptRequestId')::uuid),
    'Old-debt receipt does not reflect actual earlier balance');
  perform pg_temp.ok((select total_amount=1000 and paid_amount=500
    from public.sales where request_id='40000000-0000-4000-8000-000000008701'),
    'Historical payment corrupted current sale amounts');
  perform pg_temp.ok((select total_bottles=99 from public.stock
    where product_id='10000000-0000-4000-8000-000000008701'),'Sale stock incorrect');
  perform pg_temp.ok((select account_receipt->>'bd'='5000'
      and account_receipt->>'saleTotal'='1000'
      and account_receipt->>'paidOld'='2000'
      and account_receipt->>'paidSale'='500'
      and account_receipt->>'collected'='2500'
      and account_receipt->>'cd'='3500'
      and account_receipt->>'debtPaymentReference' is not null
    from public.sales where request_id='40000000-0000-4000-8000-000000008701'),
    'Customer statement did not freeze B/D and C/D at checkout');
  perform pg_temp.ok((select public.verify_receipt(verification_token)->'account'->>'bd'='5000'
      and public.verify_receipt(verification_token)->'account'->>'cd'='3500'
      and public.verify_receipt(verification_token)->>'amount'='500'
    from public.sales where request_id='40000000-0000-4000-8000-000000008701'),
    'QR verification did not present saved customer statement');
  -- The same saved request must not create a second payment or deduct twice.
  v := public.save_sale_with_old_debt_payment(
    '40000000-0000-4000-8000-000000008701',
    '20000000-0000-4000-8000-000000008701','2026-10-14',
    500,pg_temp.lines(),'[]','[]','cash',2000
  );
  perform pg_temp.ok((select amount=3500 from public.money_owed
    where customer_id='20000000-0000-4000-8000-000000008701'),'Retry charged old debt twice');
  perform pg_temp.ok((select count(*)=1 from public.customer_payments
    where customer_id='20000000-0000-4000-8000-000000008701'),'Retry duplicated payment ledger');
end $$;

-- A changed repayment on an existing request must not alter the money owed.
do $$ begin
  begin
    perform public.save_sale_with_old_debt_payment(
      '40000000-0000-4000-8000-000000008701',
      '20000000-0000-4000-8000-000000008701','2026-10-14',
      500,pg_temp.lines(),'[]','[]','cash',0
    );
    raise exception 'Previously saved old debt was silently removed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_sale_with_old_debt_payment(
      '40000000-0000-4000-8000-000000008701',
      '20000000-0000-4000-8000-000000008701','2026-10-14',
      500,pg_temp.lines(),'[]','[]','cash',2500
    );
    raise exception 'Previously saved old-debt amount was silently modified';
  exception when invalid_parameter_value then null; end;
end $$;

-- Paying more than previously owed must not use today's new debt as cover.
do $$ begin
  begin
    perform public.save_sale_with_old_debt_payment(
      '40000000-0000-4000-8000-000000008702',
      '20000000-0000-4000-8000-000000008701','2026-10-14',
      0,pg_temp.lines(),'[]','[]','cash',4000
    );
    raise exception 'Old-debt overpayment was accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.ok(not exists (select 1 from public.sales
  where request_id='40000000-0000-4000-8000-000000008702'),'Overpayment saved a sale');
select pg_temp.ok((select amount=3500 from public.money_owed
  where customer_id='20000000-0000-4000-8000-000000008701'),'Overpayment changed debt');

-- A subsequent sale failure must roll back the earlier payment in the same RPC.
do $$ begin
  begin
    perform public.save_sale_with_old_debt_payment(
      '40000000-0000-4000-8000-000000008703',
      '20000000-0000-4000-8000-000000008701','2026-10-14',
      0,'[]','[]','[]','cash',1000
    );
    raise exception 'Invalid sale was accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.ok((select amount=3500 from public.money_owed
  where customer_id='20000000-0000-4000-8000-000000008701'),'Failed sale deducted old debt');
select pg_temp.ok(not exists (select 1 from public.customer_payments
  where customer_id='20000000-0000-4000-8000-000000008701' and amount=1000),
  'Failed sale left a payment receipt');

-- New sale with no old-debt payment is still supported.
select public.save_sale_with_old_debt_payment(
  '40000000-0000-4000-8000-000000008704',
  '20000000-0000-4000-8000-000000008701','2026-10-14',
  1000,pg_temp.lines(),'[]','[]','transfer',0
);
select pg_temp.ok((select amount=3500 from public.money_owed
  where customer_id='20000000-0000-4000-8000-000000008701'),
  'Fully paid new sale changed the customer''s old debt');

-- Later ledger movements must never rewrite historical receipts or their QR codes.
select public.record_payment(
  '40000000-0000-4000-8000-000000008705',
  '20000000-0000-4000-8000-000000008701',
  1000, '2026-10-15', 'cash'
);
select pg_temp.ok((select amount=2500 from public.money_owed
  where customer_id='20000000-0000-4000-8000-000000008701'),
  'New payment did not update current debt');
select pg_temp.ok((select account_receipt->>'cd'='3500'
  and public.verify_receipt(verification_token)->'account'->>'cd'='3500'
  from public.sales where request_id='40000000-0000-4000-8000-000000008701'),
  'Later payment rewrote the historical statement');

-- A zero-payment sale still has a legitimate verifiable sale statement.
do $$ declare v jsonb; begin
  v := public.save_sale_with_old_debt_payment(
    '40000000-0000-4000-8000-000000008706',
    '20000000-0000-4000-8000-000000008701','2026-10-16',
    0,pg_temp.lines(),'[]','[]','not_recorded',0
  );
  perform pg_temp.ok((select account_receipt->>'bd'='2500'
    and account_receipt->>'collected'='0'
    and account_receipt->>'cd'='3500'
    and public.verify_receipt(verification_token)->>'amount'='0'
    from public.sales where request_id='40000000-0000-4000-8000-000000008706'),
    'Unpaid sale does not produce a valid historical statement');
end $$;

-- An uncertain retry after other customer activity must return the original
-- checkout's historical C/D and must not create any extra payment.
do $$ declare v jsonb; begin
  v := public.save_sale_with_old_debt_payment(
    '40000000-0000-4000-8000-000000008701',
    '20000000-0000-4000-8000-000000008701','2026-10-14',
    500,pg_temp.lines(),'[]','[]','cash',2000
  );
  perform pg_temp.ok((v->>'balanceAfter')::int=3500,
    'Retry returned the live balance instead of the original saved C/D');
end $$;
select pg_temp.ok((select count(*)=2 from public.customer_payments
  where customer_id='20000000-0000-4000-8000-000000008701'),
  'Retries duplicated the old-debt payment');

-- Customer pays only previous debt while taking a new sale on credit.
-- The sale's receipt has zero paid toward its items but confirms old-debt cash.
do $$ declare v jsonb; begin
  v := public.save_sale_with_old_debt_payment(
    '40000000-0000-4000-8000-000000008707',
    '20000000-0000-4000-8000-000000008701','2026-10-16',
    0,pg_temp.lines(),'[]','[]','transfer',1500
  );
  perform pg_temp.ok((v->>'oldDebtPaid')::int=1500 and (v->>'balanceAfter')::int=3000,
    'Old-debt-only collection was not allocated correctly');
  perform pg_temp.ok((select account_receipt->>'bd'='3500'
    and account_receipt->>'paidSale'='0'
    and account_receipt->>'paidOld'='1500'
    and account_receipt->>'collected'='1500'
    and account_receipt->>'cd'='3000'
    and public.verify_receipt(verification_token)->'account'->>'collected'='1500'
    from public.sales where request_id='40000000-0000-4000-8000-000000008707'),
    'Account receipt omitted an old-debt-only payment');
  perform pg_temp.ok((select count(*)=1 from public.customer_payments
    where request_id=(v->>'oldDebtReceiptRequestId')::uuid and amount=1500),
    'Old-debt-only checkout must have a separate payment ledger entry');
end $$;

-- The first two sales for a customer with no money_owed row must freeze
-- B/D as 0 and then 1000. Customer row locking serializes this case too.
insert into public.customers(id,name,phone)
values ('20000000-0000-4000-8000-000000008708','First Balance Customer','08000008708');
select pg_temp.ok(not exists (select 1 from public.money_owed
  where customer_id='20000000-0000-4000-8000-000000008708'),
  'Test customer unexpectedly has a money_owed row');

select public.save_sale_with_old_debt_payment(
  '40000000-0000-4000-8000-000000008708',
  '20000000-0000-4000-8000-000000008708','2026-10-14',
  0,pg_temp.lines(),'[]','[]','not_recorded',0
);
select pg_temp.ok((select account_receipt->>'bd'='0'
  and account_receipt->>'cd'='1000'
  from public.sales where request_id='40000000-0000-4000-8000-000000008708'),
  'First credit sale froze the wrong opening balance');

select public.save_sale_with_old_debt_payment(
  '40000000-0000-4000-8000-000000008709',
  '20000000-0000-4000-8000-000000008708','2026-10-14',
  0,pg_temp.lines(),'[]','[]','not_recorded',0
);
select pg_temp.ok((select account_receipt->>'bd'='1000'
  and account_receipt->>'cd'='2000'
  and public.verify_receipt(verification_token)->'account'->>'bd'='1000'
  from public.sales where request_id='40000000-0000-4000-8000-000000008709'),
  'Following credit sale did not carry forward the previous balance');

-- No privilege for other signed-in users or anonymous callers.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000008702',true);
do $$ begin
  begin
    perform public.save_sale_with_old_debt_payment(
      gen_random_uuid(),'20000000-0000-4000-8000-000000008701','2026-10-14',
      1000,pg_temp.lines(),'[]','[]','cash',100
    );
    raise exception 'Non-owner was permitted';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.save_sale_with_old_debt_payment(
      gen_random_uuid(),'20000000-0000-4000-8000-000000008701','2026-10-14',
      1000,pg_temp.lines(),'[]','[]','cash',100
    );
    raise exception 'Anonymous caller was permitted';
  exception when insufficient_privilege or undefined_function then null; end;
end $$;
rollback;
