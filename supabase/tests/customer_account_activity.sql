-- Disposable PostgreSQL test: accurate account badges and standalone empties history.
-- All fixtures are isolated and rolled back.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000751'),
  ('00000000-0000-4000-8000-000000000752');
insert into private.shop_owner(user_id)
  values ('00000000-0000-4000-8000-000000000751');
insert into public.customers(id,name,phone) values
  ('10000000-0000-4000-8000-000000000751','History test customer','+2348030000751'),
  ('10000000-0000-4000-8000-000000000752','Other customer','+2348030000752');
insert into public.crate_types(id,name,empty_family,pocket_count)
  values ('20000000-0000-4000-8000-000000000751','History test crate','NB',12);
insert into public.crate_obligations(customer_id,crate_type_id,quantity)
  values ('10000000-0000-4000-8000-000000000751','20000000-0000-4000-8000-000000000751',2);
insert into public.bottle_obligations(customer_id,bottle_type,quantity)
  values ('10000000-0000-4000-8000-000000000751','History test bottle',3);
insert into private.customer_empty_returns(request_id,customer_id,request_payload,created_at)
  values (
    '30000000-0000-4000-8000-000000000751',
    '10000000-0000-4000-8000-000000000751',
    '{"crates":[{"crateTypeId":"20000000-0000-4000-8000-000000000751","quantity":2}],"bottles":[{"bottleType":"History test bottle","quantity":3}],"released":[]}'::jsonb,
    '2026-10-14 07:30:00+00'::timestamptz
  );
-- A held decision can represent many physical empties. Released decisions are
-- retained in history; only unreleased decisions belong in the current badge.
insert into public.products
  (id,name,bottles_per_crate,full_crate_price,bottles_returnable,bottle_type,crate_type_id)
values ('40000000-0000-4000-8000-000000000751','History test drink',12,12000,true,'History test bottle','20000000-0000-4000-8000-000000000751');
insert into public.sales
  (id,customer_id,total_amount,paid_amount,business_date,request_id,request_payload)
values
  ('50000000-0000-4000-8000-000000000751','10000000-0000-4000-8000-000000000751',0,0,'2026-10-13','70000000-0000-4000-8000-000000000751','{}'::jsonb),
  ('50000000-0000-4000-8000-000000000752','10000000-0000-4000-8000-000000000752',0,0,'2026-10-13','70000000-0000-4000-8000-000000000752','{}'::jsonb);
insert into public.sale_empty_decisions
  (id,sale_id,customer_id,product_id,product_name,kind,returned_type,returned_name,owed_type,owed_name,quantity,decision,released_at)
values
  ('60000000-0000-4000-8000-000000000751','50000000-0000-4000-8000-000000000751','10000000-0000-4000-8000-000000000751','40000000-0000-4000-8000-000000000751','History test drink','crate','wrong crate','Wrong crate','right crate','Right crate',4,'hold','2026-10-14 08:30:00+00'),
  ('60000000-0000-4000-8000-000000000752','50000000-0000-4000-8000-000000000751','10000000-0000-4000-8000-000000000751','40000000-0000-4000-8000-000000000751','History test drink','bottle','wrong bottle','Wrong bottle','right bottle','Right bottle',12,'hold','2026-10-14 08:30:00+00'),
  ('60000000-0000-4000-8000-000000000753','50000000-0000-4000-8000-000000000751','10000000-0000-4000-8000-000000000751','40000000-0000-4000-8000-000000000751','History test drink','crate','wrong crate','Wrong crate','right crate','Right crate',2,'hold',null),
  ('60000000-0000-4000-8000-000000000754','50000000-0000-4000-8000-000000000751','10000000-0000-4000-8000-000000000751','40000000-0000-4000-8000-000000000751','History test drink','bottle','wrong bottle','Wrong bottle','right bottle','Right bottle',7,'hold',null),
  ('60000000-0000-4000-8000-000000000755','50000000-0000-4000-8000-000000000752','10000000-0000-4000-8000-000000000752','40000000-0000-4000-8000-000000000751','History test drink','crate','wrong crate','Wrong crate','right crate','Right crate',8,'hold',null),
  ('60000000-0000-4000-8000-000000000756','50000000-0000-4000-8000-000000000752','10000000-0000-4000-8000-000000000752','40000000-0000-4000-8000-000000000751','History test drink','bottle','wrong bottle','Wrong bottle','right bottle','Right bottle',5,'hold','2026-10-14 08:45:00+00');
-- A mixed return combines new correct empties with handing held property back.
insert into private.customer_empty_returns(request_id,customer_id,request_payload,created_at)
values
  ('30000000-0000-4000-8000-000000000752','10000000-0000-4000-8000-000000000751',
   '{"crates":[{"quantity":2}],"bottles":[{"quantity":3}],"released":["60000000-0000-4000-8000-000000000751","60000000-0000-4000-8000-000000000752"]}'::jsonb,
   '2026-10-14 08:30:00+00'),
  -- An unrelated decision ID must never inflate this customer's activity.
  ('30000000-0000-4000-8000-000000000753','10000000-0000-4000-8000-000000000752',
   '{"crates":[],"bottles":[],"released":["60000000-0000-4000-8000-000000000751","60000000-0000-4000-8000-000000000756"]}'::jsonb,
   '2026-10-14 08:45:00+00');
-- More than 1000 held rows for one customer must not be truncated by PostgREST.
insert into public.sale_empty_decisions
  (sale_id,customer_id,product_id,product_name,kind,returned_type,returned_name,owed_type,owed_name,quantity,decision)
select '50000000-0000-4000-8000-000000000752','10000000-0000-4000-8000-000000000752',
       '40000000-0000-4000-8000-000000000751','History test drink','bottle','wrong bottle','Wrong bottle',
       'right bottle','Right bottle',1,'hold'
from generate_series(1,1100);

create function pg_temp.check_true(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000751',true);

select pg_temp.check_true(
  (select crates_owed=2 and bottles_owed=3 and held_entries=2
     from public.customer_account_snapshot(array['10000000-0000-4000-8000-000000000751'::uuid])),
  'Account badge aggregates do not match independent crate and bottle ledgers');
select pg_temp.check_true(
  (select count(*)=2 from public.customer_account_snapshot(array[
     '10000000-0000-4000-8000-000000000751'::uuid,
     '10000000-0000-4000-8000-000000000752'::uuid])),
  'Account snapshot omitted a visible customer');
select pg_temp.check_true(
  (select held_entries=1101 and crates_owed=0 and bottles_owed=0
     from public.customer_account_snapshot(array['10000000-0000-4000-8000-000000000752'::uuid])),
  'Open held entries were capped or did not exclude released decisions');
select pg_temp.check_true(
  exists(select 1 from pg_indexes
         where schemaname='public' and tablename='sale_empty_decisions'
           and indexname='sale_empty_decisions_open_held_customer_idx'),
  'Index for open held entries is missing');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000751','all',10,0)
    -> 'items' -> 0 ->> 'title')='Returned 2 crates, 3 bottles · Customer collected 4 held crates, 12 held bottles',
  'Mixed return failed to sum physical held crate and bottle quantities');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000751','all',10,0)
    -> 'items' -> 1 ->> 'title')='Returned 2 crates, 3 bottles',
  'Standalone return without held decisions changed unexpectedly');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000752','all',10,0)
    ->>'count')::integer=1,
  'Customer activity leaked another customer return');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000752','empties',10,0)
    -> 'items' -> 0 ->> 'title')='Customer collected 0 held crates, 5 held bottles',
  'Released-only activity counted a different customer''s held decisions');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000751','empties',10,0)
    ->>'count')::integer=2,
  'Standalone empties returns missing from filtered full activity');
do $$ begin
  begin
    perform * from public.customer_account_snapshot(array_fill('10000000-0000-4000-8000-000000000751'::uuid,array[31]));
    raise exception 'Unbounded snapshot request allowed';
  exception when invalid_parameter_value then null; end;
end $$;

-- A signed-in non-owner cannot see the aggregates or the activity feed.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000752',true);
do $$ begin
  begin
    perform * from public.customer_account_snapshot(array['10000000-0000-4000-8000-000000000751'::uuid]);
    raise exception 'Non-owner read account summary';
  exception when insufficient_privilege then null; end;
  begin
    perform public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000751','all',10,0);
    raise exception 'Non-owner read activity';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
