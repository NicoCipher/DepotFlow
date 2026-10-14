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
create function pg_temp.check_true(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000751',true);

select pg_temp.check_true(
  (select crates_owed=2 and bottles_owed=3 and held_entries=0
     from public.customer_account_snapshot(array['10000000-0000-4000-8000-000000000751'::uuid])),
  'Account badge aggregates do not match independent crate and bottle ledgers');
select pg_temp.check_true(
  (select count(*)=2 from public.customer_account_snapshot(array[
     '10000000-0000-4000-8000-000000000751'::uuid,
     '10000000-0000-4000-8000-000000000752'::uuid])),
  'Account snapshot omitted a visible customer');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000751','all',10,0)
    -> 'items' -> 0 ->> 'title')='Returned 2 crates, 3 bottles',
  'Standalone customer empties return is missing from the chronological feed');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000752','all',10,0)
    ->>'count')::integer=0,
  'Customer activity leaked another customer return');
select pg_temp.check_true(
  (public.store_activity('2026-10-14','2026-10-14','10000000-0000-4000-8000-000000000751','empties',10,0)
    ->>'count')::integer=1,
  'Standalone empties return missing from filtered full activity');
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
