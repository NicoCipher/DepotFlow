-- Regression: an absent split request cannot save later, even through
-- another sale entry point. Disposable migrated PostgreSQL, rolled back.
begin;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000009721'),
 ('00000000-0000-4000-8000-000000009722');
insert into private.shop_owner(user_id)
 values ('00000000-0000-4000-8000-000000009721');
insert into public.customers(id,name,phone)
 values ('20000000-0000-4000-8000-000000009721','Fence Test','08000009721');
create function pg_temp.ok(v boolean,m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception '%',m; end if; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009721',true);
select pg_temp.ok(
 public.check_split_sale_request('40000000-0000-4000-8000-000000009721')->>'state'='absent',
 'Missing request should be reported absent and fenced');
-- Same call remains idempotent and does not invent a financial transaction.
select pg_temp.ok(
 public.check_split_sale_request('40000000-0000-4000-8000-000000009721')->>'state'='absent',
 'Repeated recovery of an abandoned request changed state');

reset role;
select pg_temp.ok(
 (select count(*)=1 from private.split_sale_request_fences
   where request_id='40000000-0000-4000-8000-000000009721'),
 'Recovery did not create one immutable request fence');

do $$ begin
  begin
    insert into public.sales(id,customer_id,request_id,total_amount,paid_amount,business_date,payment_method)
    values ('30000000-0000-4000-8000-000000009721',
            '20000000-0000-4000-8000-000000009721',
            '40000000-0000-4000-8000-000000009721',
            1700,1700,'2026-10-16','cash');
    raise exception 'A delayed sale inserted after its request was fenced';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.ok(not exists(select 1 from public.sales
  where request_id='40000000-0000-4000-8000-000000009721'),
  'Fenced sale was recorded after recovery');
select pg_temp.ok(not exists(select 1 from public.customer_payments
  where customer_id='20000000-0000-4000-8000-000000009721'),
  'Fenced recovery wrote a payment');
select pg_temp.ok((select count(*)=0 from public.sale_tender_legs),
  'Fenced recovery invented split tender entries');

-- Fresh request IDs and ordinary sales are unaffected.
insert into public.sales(id,customer_id,request_id,total_amount,paid_amount,business_date,payment_method)
values ('30000000-0000-4000-8000-000000009722',
        '20000000-0000-4000-8000-000000009721',
        '40000000-0000-4000-8000-000000009722',
        1700,1700,'2026-10-16','cash');
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009721',true);
select pg_temp.ok(
 public.check_split_sale_request('40000000-0000-4000-8000-000000009722')->>'state'='different',
 'Legacy sale was reported as a split');
reset role;
select pg_temp.ok(
 (select count(*)=1 from private.split_sale_request_fences),
 'A committed legacy sale was incorrectly fenced');

-- Only owner can create fences through authenticated status reconciliation.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000009722',true);
do $$ begin
 begin
  perform public.check_split_sale_request('40000000-0000-4000-8000-000000009723');
  raise exception 'Non-owner fenced a sale request';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.ok(
 not exists(select 1 from private.split_sale_request_fences
  where request_id='40000000-0000-4000-8000-000000009723'),
 'Unauthorized recovery wrote a fence');
rollback;
