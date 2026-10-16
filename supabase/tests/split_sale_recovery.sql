-- Read-only recovery API checks the same request lock as the atomic saver.
-- Runs against disposable migrated PostgreSQL and never touches production.
begin;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000009711'),
 ('00000000-0000-4000-8000-000000009712');
insert into private.shop_owner(user_id)
 values ('00000000-0000-4000-8000-000000009711');
insert into public.customers(id,name,phone)
 values ('20000000-0000-4000-8000-000000009711','Recovery Test','08000009711');
create function pg_temp.ok(test boolean, msg text) returns void language plpgsql as $$
begin
 if test is distinct from true then raise exception '%',msg; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000009711',true);
select pg_temp.ok(
 (public.check_split_sale_request('40000000-0000-4000-8000-000000009711')->>'state')='absent',
 'Missing request must be reported as absent after acquiring its request lock');

-- A legacy request with the same identifier must not be mistaken for a split.
reset role;
insert into public.sales(
 id, customer_id, request_id, total_amount, paid_amount, business_date, payment_method
) values (
 '30000000-0000-4000-8000-000000009711',
 '20000000-0000-4000-8000-000000009711',
 '40000000-0000-4000-8000-000000009712',
 1700,1700,'2026-10-16','cash'
);
-- A mixed sale has to contain two immutable legs and frozen account receipt.
insert into public.sales(
 id, customer_id, request_id, total_amount, paid_amount, business_date,
 payment_method, split_request_hash, account_receipt
) values (
 '30000000-0000-4000-8000-000000009712',
 '20000000-0000-4000-8000-000000009711',
 '40000000-0000-4000-8000-000000009713',
 1700,1700,'2026-10-16',
 'mixed','0123456789abcdef0123456789abcdef',
 '{"paidOld":0,"paidSale":1700,"collected":1700,"cd":0}'::jsonb
);
insert into public.sale_tender_legs(sale_id,method,sale_amount,old_debt_amount)
 values
 ('30000000-0000-4000-8000-000000009712','cash',700,0),
 ('30000000-0000-4000-8000-000000009712','transfer',1000,0);
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000009711',true);
select pg_temp.ok(
 (public.check_split_sale_request('40000000-0000-4000-8000-000000009712')->>'state')='different',
 'A legacy sale must never appear as an authenticated split');
select pg_temp.ok(
 (public.check_split_sale_request('40000000-0000-4000-8000-000000009713')->>'state')='saved',
 'Committed split request must be recognized');
select pg_temp.ok(
 (public.check_split_sale_request('40000000-0000-4000-8000-000000009713')->>'saleId')=
 '30000000-0000-4000-8000-000000009712',
 'Recovery must return the immutable saved sale ID');
select pg_temp.ok(
 (select count(*)=2 from public.sales)
 and (select count(*)=2 from public.sale_tender_legs),
 'Read-only check modified the ledger');

-- Non-owner cannot probe sale existence.
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000009712',true);
do $$ begin
 begin
  perform public.check_split_sale_request('40000000-0000-4000-8000-000000009713');
  raise exception 'Non-owner read recovery status';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.check_split_sale_request('40000000-0000-4000-8000-000000009713');
  raise exception 'Anonymous caller read recovery status';
 exception when insufficient_privilege or undefined_function then null; end;
end $$;
rollback;
