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

-- Reproduce migration's historical backfill on fixture data: previously
-- recorded return-form releases must not become duplicate direct events.
-- A separately released decision should be included. Roll back this probe
-- so downstream activity counts still describe the original test fixtures.
reset role;
insert into public.sale_empty_decisions
  (id,sale_id,customer_id,product_id,product_name,kind,returned_type,returned_name,owed_type,owed_name,quantity,decision,released_at)
values (
  '60000000-0000-4000-8000-000000000757','50000000-0000-4000-8000-000000000751',
  '10000000-0000-4000-8000-000000000751','40000000-0000-4000-8000-000000000751',
  'History test drink','bottle','wrong bottle','Wrong bottle','right bottle','Right bottle',9,'hold',
  '2026-10-14 08:50:00+00'
);
set local role authenticated;
savepoint historical_backfill_probe;
reset role;
with form_releases as materialized (
  select distinct r.customer_id, released.id::uuid as decision_id
  from private.customer_empty_returns r
  cross join lateral jsonb_array_elements_text(
    coalesce(r.request_payload->'released','[]'::jsonb)
  ) released(id)
)
insert into private.held_empty_collections(decision_id,customer_id,collected_at)
select d.id,d.customer_id,d.released_at
from public.sale_empty_decisions d
left join form_releases f on f.customer_id=d.customer_id and f.decision_id=d.id
where d.decision='hold' and d.released_at is not null and f.decision_id is null;
select pg_temp.check_true(
  (select count(*)=1 from private.held_empty_collections
   where decision_id='60000000-0000-4000-8000-000000000757'),
  'Historic direct held release not captured in backfill');
select pg_temp.check_true(
  (select count(*)=0 from private.held_empty_collections
   where decision_id in (
     '60000000-0000-4000-8000-000000000751',
     '60000000-0000-4000-8000-000000000752',
     '60000000-0000-4000-8000-000000000756'
   )),
  'Historic form-based held releases double-counted in backfill');
rollback to savepoint historical_backfill_probe;
set local role authenticated;

-- Direct inline collections are separate historical events, including replays.
-- Each decision's physical quantity is displayed, not one item per UUID.
select public.release_held_empties('60000000-0000-4000-8000-000000000753');
select public.release_held_empties('60000000-0000-4000-8000-000000000753');
select public.release_held_empties('60000000-0000-4000-8000-000000000754');
select pg_temp.check_true(
  (select held_entries=0 from public.customer_account_snapshot(
    array['10000000-0000-4000-8000-000000000751'::uuid])),
  'Inline collection failed to resolve open held counts');
select pg_temp.check_true(
  (public.store_activity('2026-01-01','2026-12-31',
    '10000000-0000-4000-8000-000000000751','empties',30,0)->>'count')::int=4,
  'Inline events missing, replay duplicated, or mixed return double-counted');
select pg_temp.check_true(
  exists(select 1 from jsonb_array_elements(public.store_activity(
     '2026-01-01','2026-12-31','10000000-0000-4000-8000-000000000751',
     'empties',30,0)->'items') item
     where item->>'title'='Customer collected 2 held crates'),
  'Inline held crate collection quantity missing from full history');
select pg_temp.check_true(
  exists(select 1 from jsonb_array_elements(public.store_activity(
     '2026-01-01','2026-12-31','10000000-0000-4000-8000-000000000751',
     'empties',30,0)->'items') item
     where item->>'title'='Customer collected 7 held bottles'),
  'Inline held bottle collection quantity missing from full history');
select pg_temp.check_true(
  exists(select 1 from jsonb_array_elements(public.customer_recent_activity(
    '10000000-0000-4000-8000-000000000751')->'items') item
    where item->>'title'='Customer collected 2 held crates'),
  'Recent customer account did not show inline collections');
select pg_temp.check_true(
  (select count(*)=0 from jsonb_array_elements(public.customer_recent_activity(
    '10000000-0000-4000-8000-000000000752')->'items') item
    where item->>'title' in ('Customer collected 2 held crates','Customer collected 7 held bottles')),
  'Recent feed included another customer''s collection');
-- Confirm form-based releases remain one event, not duplicated by direct history.
select pg_temp.check_true(
  (select count(*)=1 from jsonb_array_elements(public.customer_recent_activity(
    '10000000-0000-4000-8000-000000000751')->'items') item
    where item->>'title'='Returned 2 crates, 3 bottles · Customer collected 4 held crates, 12 held bottles'),
  'Mixed form return disappeared or appeared twice');

-- An account with a long history must still receive just six recent entries.
-- The fixture insert runs as the database test owner, never as the shop role.
reset role;
insert into public.sales(customer_id,total_amount,paid_amount,business_date,request_id,request_payload)
select '10000000-0000-4000-8000-000000000751',0,0,'2026-09-01',
  gen_random_uuid(),'{}'::jsonb from generate_series(1,50);
set local role authenticated;
select pg_temp.check_true(
  jsonb_array_length(public.customer_recent_activity(
    '10000000-0000-4000-8000-000000000751')->'items')=6,
  'Account feed did not stay bounded to six entries');
select pg_temp.check_true(
  not (public.customer_recent_activity(
    '10000000-0000-4000-8000-000000000751') ? 'sales_value'),
  'Recent account feed unnecessarily computed full-history totals');

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
  begin
    perform public.customer_recent_activity('10000000-0000-4000-8000-000000000751');
    raise exception 'Non-owner read recent customer activity';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
