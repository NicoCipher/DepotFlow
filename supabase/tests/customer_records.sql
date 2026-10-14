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
  (public.customer_records('2026-10-14','2026-10-14','all','all','',30,0)->>'count')::integer=5,
  'Missing a sale, standalone return, payment or opening record');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
   '2026-10-14','2026-10-14','sale','all','Royal Hotel',30,0)->'items') e
   where e->>'sale_total'='85000' and e->>'received'='40000'
    and e->>'remaining'='45000' and e->>'status'='partial'),
  'Sale mixed up value, amount received, or balance');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','payment','transfer','Royal',30,0)->'items') e
    where e->>'received'='10000' and e->>'sale_total'='0'),
  'Separate debt payment is not independently recorded');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','cash','',30,0)->>'count')::integer=1,
  'Payment-method filter incorrectly included non-cash records');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','transfer','',30,0)->>'count')::integer=1,
  'Transfer method incorrectly matched a sale with no new-sale payment');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','sale','transfer','',30,0)->>'count')::integer=0,
  'An unpaid sale inherited the method of an old-debt payment');
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','sale','all','+2348000000962',30,0)->>'count')::integer=1,
  'Customer phone search missed an unpaid sale');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','sale','all','',30,0)->'items') e
     where e->>'customer_name'='Another buyer' and e->>'status'='unpaid' and e->>'received'='0'),
  'Unpaid sale was incorrectly marked received');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
    '2026-10-14','2026-10-14','empties','all','',30,0)->'items') e
   where e->>'crates'='2' and e->>'bottles'='12'
     and e->>'received'='0' and e->>'detail'='/records/empties/60000000-0000-4000-8000-000000000961'),
  'Standalone returned empties were missing or treated as money');
select pg_temp.ensure(
  (select count(*)=1 from jsonb_array_elements(public.customer_records(
   '2026-10-14','2026-10-14','opening','all','',30,0)->'items') e
   where e->>'remaining'='5000' and e->>'received'='0'),
  'Opening balance was incorrectly marked as money received');
select pg_temp.ensure(
  jsonb_array_length(public.customer_records('2026-10-14','2026-10-14',
    'all','all','',2,0)->'items')=2 and
  jsonb_array_length(public.customer_records('2026-10-14','2026-10-14',
    'all','all','',2,2)->'items')=2,
  'Records pagination is inaccurate');
select pg_temp.ensure(
  (public.customer_return_record('60000000-0000-4000-8000-000000000961')->'crates'->0->>'name')='Royal Test Crate'
   and (public.customer_return_record('60000000-0000-4000-8000-000000000961')->'bottles'->0->>'quantity')='12',
  'Saved empties detail did not use exact types and quantities');

-- An item added after the first page's snapshot must not enter page two.
select set_config('test.records_snapshot',
  public.customer_records('2026-10-14','2026-10-14','all','all','',2,0)->>'snapshot',true);
reset role;
insert into public.customer_payments
  (customer_id,amount,owed_after,business_date,request_id,method,created_at)
values
  ('10000000-0000-4000-8000-000000000961',2000,33000,'2026-10-14',
   '50000000-0000-4000-8000-000000000962','cash',
   current_setting('test.records_snapshot')::timestamptz + interval '1 minute');
set local role authenticated;
select pg_temp.ensure(
  (public.customer_records('2026-10-14','2026-10-14','all','all','',30,0,
     current_setting('test.records_snapshot')::timestamptz)->>'count')::integer=5,
  'Record pagination did not exclude entries created after its snapshot');
do $$ begin
  begin
    perform public.customer_records('2026-10-14','2026-10-14','nonsense','all','',30,0);
    raise exception 'Accepted invalid record kind';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000962',true);
do $$ begin
  begin
    perform public.customer_records('2026-10-14','2026-10-14','all','all','',30,0);
    raise exception 'A non-owner viewed customer records';
  exception when insufficient_privilege then null; end;
  begin
    perform public.customer_return_record('60000000-0000-4000-8000-000000000961');
    raise exception 'A non-owner viewed private empties details';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
