-- Disposable PostgreSQL 16: records are independent views of original ledgers.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000961'),
  ('00000000-0000-4000-8000-000000000962');
insert into private.shop_owner(user_id) values
  ('00000000-0000-4000-8000-000000000961');
insert into public.customers(id,name,phone,business_name) values
  ('10000000-0000-4000-8000-000000000961','Royal','+2348000000961','Royal Hotel'),
  ('10000000-0000-4000-8000-000000000962','Another buyer','+2348000000962',null);
insert into public.sales(id,customer_id,total_amount,paid_amount,business_date,request_id,request_payload)
values
  ('20000000-0000-4000-8000-000000000961','10000000-0000-4000-8000-000000000961',85000,40000,'2026-10-14','30000000-0000-4000-8000-000000000961','{}'::jsonb),
  ('20000000-0000-4000-8000-000000000962','10000000-0000-4000-8000-000000000962',5000,0,'2026-10-14','30000000-0000-4000-8000-000000000962','{}'::jsonb);
update public.sales set payment_method='cash' where id='20000000-0000-4000-8000-000000000961';
-- A separate old-debt payment may leave its method on a zero-paid sale.
update public.sales set payment_method='transfer' where id='20000000-0000-4000-8000-000000000962';
insert into public.customer_payments(id,customer_id,amount,owed_after,business_date,request_id,method)
values ('40000000-0000-4000-8000-000000000961','10000000-0000-4000-8000-000000000961',10000,35000,'2026-10-14','50000000-0000-4000-8000-000000000961','transfer');
insert into private.customer_empty_returns(request_id,customer_id,request_payload,created_at)
values ('60000000-0000-4000-8000-000000000961','10000000-0000-4000-8000-000000000961',
'{"crates":[{"crateTypeId":"70000000-0000-4000-8000-000000000961","quantity":2}],"bottles":[{"bottleType":"Royal Test Bottle","quantity":12}],"released":[]}'::jsonb,'2026-10-14 12:00:00+00');
insert into public.customer_opening_balances
(id,customer_id,request_id,amount,business_date,note,crates,bottles,request_payload)
values ('80000000-0000-4000-8000-000000000961','10000000-0000-4000-8000-000000000962',
'90000000-0000-4000-8000-000000000961',5000,'2026-10-14','',
'[]'::jsonb,'[]'::jsonb,'{}'::jsonb);
insert into public.crate_types(id,name,empty_family,pocket_count)
values ('70000000-0000-4000-8000-000000000961','Royal Test Crate','NB',12);
create function pg_temp.ensure(ok boolean, note text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',note; end if; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000961',true);

select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','all','',30)->>'count')::integer=5,
  'Missing a sale, standalone return, payment or opening record');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
   '2026-10-14','2026-10-14','sale','all','Royal Hotel',30)->'items') e
   where e->>'sale_total'='85000' and e->>'received'='40000'
    and e->>'remaining'='45000' and e->>'status'='partial'),
  'Sale mixed up value, amount received, or balance');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','payment','transfer','Royal',30)->'items') e
    where e->>'received'='10000' and e->>'sale_total'='0'),
  'Separate debt payment is not independently recorded');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','cash','',30)->>'count')::integer=1,
  'Payment-method filter incorrectly included non-cash records');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','transfer','',30)->>'count')::integer=1,
  'Transfer method incorrectly matched a sale with no new-sale payment');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','sale','transfer','',30)->>'count')::integer=0,
  'An unpaid sale inherited the method of an old-debt payment');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','sale','all','+2348000000962',30)->>'count')::integer=1,
  'Customer phone search missed an unpaid sale');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','sale','all','',30)->'items') e
     where e->>'customer_name'='Another buyer' and e->>'status'='unpaid' and e->>'received'='0'),
  'Unpaid sale was incorrectly marked received');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','empties','all','',30)->'items') e
   where e->>'crates'='2' and e->>'bottles'='12'
     and e->>'received'='0' and e->>'detail'='/records/empties/60000000-0000-4000-8000-000000000961'),
  'Standalone returned empties were missing or treated as money');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
   '2026-10-14','2026-10-14','opening','all','',30)->'items') e
   where e->>'remaining'='5000' and e->>'received'='0'),
  'Opening balance was incorrectly marked as money received');
-- Historical receipts display their saved names while a newly edited
-- customer name must still find both sales and debt payments.
savepoint renamed_customer_probe;
reset role;
update public.sales set receipt_customer_name='Original customer at checkout'
where id='20000000-0000-4000-8000-000000000961';
update public.customer_payments set receipt_customer_name='Original customer at payment'
where id='40000000-0000-4000-8000-000000000961';
update public.customers set name='Kemi Daramola'
where id='10000000-0000-4000-8000-000000000961';
set local role authenticated;
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','sale','all','Kemi Daramola',30)->'items') e
    where e->>'customer_name'='Original customer at checkout'),
  'Sale search did not find the current customer name without changing receipt identity');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','payment','all','Kemi Daramola',30)->'items') e
    where e->>'customer_name'='Original customer at payment'),
  'Payment search did not find a renamed customer while preserving saved receipt name');
rollback to savepoint renamed_customer_probe;
set local role authenticated;

-- A single checkout settles old debt and sells new drinks. The original
-- payment ledger still exists but must not look like a second shop visit.
savepoint combined_checkout_probe;
reset role;
update public.sales
  set account_receipt=jsonb_build_object(
    'bd',45000,'saleTotal',85000,'paidSale',40000,'paidOld',10000,
    'collected',50000,'cd',80000,
    'debtPaymentReference',(select receipt_number from public.customer_payments
      where id='40000000-0000-4000-8000-000000000961'))
  where id='20000000-0000-4000-8000-000000000961';
update public.customer_payments set method='cash'
  where id='40000000-0000-4000-8000-000000000961';
set local role authenticated;
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','all','',30)->>'count')::integer=4,
  'Combined sale-and-old-debt payment was shown as two visits');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
   '2026-10-14','2026-10-14','all','cash','',30)->'items') e
   where e->>'kind'='sale' and e->>'sale_total'='85000'
     and e->>'received'='40000' and e->>'old_debt_paid'='10000'
     and e->>'checkout_received'='50000' and e->>'checkout_balance'='80000'),
  'Combined sale does not preserve sale payment separately from total cash collected');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','payment','cash','Royal',30)->'items') e
    where e->>'id'='40000000-0000-4000-8000-000000000961'
      and e->>'received'='10000' and
      e->>'linked_sale_id'='20000000-0000-4000-8000-000000000961'),
  'Linked old-debt receipt disappeared from Payments filter');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','all','all',
    (select receipt_number from public.customer_payments
     where id='40000000-0000-4000-8000-000000000961'),30)->'items') e
    where e->>'kind'='sale' and e->>'id'='20000000-0000-4000-8000-000000000961'),
  'Searching the old-debt receipt number did not find its combined checkout');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','payment','all','',30)->'items') e
    where e->>'linked_sale_id'='20000000-0000-4000-8000-000000000961'),
  'Payment filter no longer exposes linked old debt payments');
savepoint voided_payment_check;
reset role;
update public.customer_payments set receipt_status='voided'
  where id='40000000-0000-4000-8000-000000000961';
set local role authenticated;
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','all','',30)->>'count')::integer=5,
  'Voided debt payment was hidden from All Records');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','all','all','',30)->'items') e
    where e->>'kind'='sale' and e->>'linked_payment_voided'='true'),
  'Sale failed to flag its separately voided old-debt payment');
rollback to savepoint voided_payment_check;
set local role authenticated;

rollback to savepoint combined_checkout_probe;
set local role authenticated;

-- Forward pages use a precise event cursor, not an offset.
select set_config('test.page1',
  public.customer_records('2026-10-14','2026-10-14','all','all','',2)::text,true);
select pg_temp.ensure(
  jsonb_array_length(current_setting('test.page1')::jsonb->'items')=2
  and (current_setting('test.page1')::jsonb->>'has_more')::boolean,
  'Records first page does not include two items and a next-page signal');
select set_config('test.next_cursor',
  (select jsonb_build_object(
    'day',e.item->>'day','created_at',e.item->>'created_at',
    'kind',e.item->>'kind','id',e.item->>'id')::text
    from jsonb_array_elements(current_setting('test.page1')::jsonb->'items')
      with ordinality as e(item,n) where e.n=2),true);
select set_config('test.page2',
  public.customer_records('2026-10-14','2026-10-14',
    'all','all','',2,current_setting('test.next_cursor')::jsonb,false)::text,true);
select pg_temp.ensure(
  jsonb_array_length(current_setting('test.page2')::jsonb->'items')=2,
  'Record next page has wrong size');
select pg_temp.ensure(
  (select count(*)=0
   from jsonb_array_elements(current_setting('test.page1')::jsonb->'items') a
   join jsonb_array_elements(current_setting('test.page2')::jsonb->'items') b
     on (a->>'id',a->>'kind')=(b->>'id',b->>'kind')),
  'Next page repeated an event from the prior page');

select pg_temp.ensure(
  (public.customer_return_record('60000000-0000-4000-8000-000000000961')->'crates'->0->>'name')='Royal Test Crate'
   and (public.customer_return_record('60000000-0000-4000-8000-000000000961')->'bottles'->0->>'quantity')='12',
  'Saved empties detail did not use exact types and quantities');

-- A committed late row with an earlier transaction-created timestamp
-- can shift offset-based pages. The keyset preserves the original boundary.
reset role;
insert into public.customer_payments
  (customer_id,amount,owed_after,business_date,request_id,method,created_at)
values
  ('10000000-0000-4000-8000-000000000961',2000,33000,'2026-10-14',
   '50000000-0000-4000-8000-000000000962','cash',now()+interval '1 minute');
set local role authenticated;
select pg_temp.ensure(
  (select count(*)=0
   from jsonb_array_elements(current_setting('test.page1')::jsonb->'items') a
   join jsonb_array_elements(public.customer_records(
      '2026-10-14','2026-10-14','all','all','',2,
      current_setting('test.next_cursor')::jsonb,false)->'items') b
     on (a->>'id',a->>'kind')=(b->>'id',b->>'kind')),
  'Late committed row caused duplicate items on page two');
select set_config('test.back_cursor',
  (select jsonb_build_object(
    'day',e.item->>'day','created_at',e.item->>'created_at',
    'kind',e.item->>'kind','id',e.item->>'id')::text
    from jsonb_array_elements(current_setting('test.page2')::jsonb->'items')
      with ordinality as e(item,n) where e.n=1),true);
select pg_temp.ensure(
  (select array_agg(x->>'id' order by ordinality)
   from jsonb_array_elements(public.customer_records(
      '2026-10-14','2026-10-14','all','all','',2,
      current_setting('test.back_cursor')::jsonb,true)->'items')
     with ordinality as a(x,ordinality))
  =
  (select array_agg(x->>'id' order by ordinality)
   from jsonb_array_elements(current_setting('test.page1')::jsonb->'items')
     with ordinality as a(x,ordinality)),
  'Previous cursor did not return the original first page');
do $$ begin
  begin
    perform public.customer_records('2026-10-14','2026-10-14','nonsense','all','',30);
    raise exception 'Accepted invalid record kind';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000962',true);
do $$ begin
  begin
    perform public.customer_records('2026-10-14','2026-10-14','all','all','',30);
    raise exception 'A non-owner viewed customer records';
  exception when insufficient_privilege then null; end;
  begin
    perform public.customer_return_record('60000000-0000-4000-8000-000000000961');
    raise exception 'A non-owner viewed private empties details';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
