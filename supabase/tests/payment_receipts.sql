begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000009201');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000009201');
insert into public.customers(id,name,phone) values ('10000000-0000-4000-8000-000000009201','Ada Test','+2348000000000');
insert into public.money_owed(customer_id,amount) values ('10000000-0000-4000-8000-000000009201',5000);
create function pg_temp.ok(v boolean,m text) returns void language plpgsql as $$begin if v is distinct from true then raise exception '%',m; end if; end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009201',true);
do $$begin
  begin
    perform public.record_payment('20000000-0000-4000-8000-000000009201','10000000-0000-4000-8000-000000009201',7000,'2026-09-28','cash');
    raise exception 'Overpayment accepted';
  exception when invalid_parameter_value then null; end;
end$$;
select pg_temp.ok((select amount=5000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000009201'),'Overpayment changed balance');
select public.record_payment('20000000-0000-4000-8000-000000009201','10000000-0000-4000-8000-000000009201',3000,'2026-09-28','transfer');
select public.record_payment('20000000-0000-4000-8000-000000009201','10000000-0000-4000-8000-000000009201',3000,'2026-09-28','transfer');
select pg_temp.ok((select count(*)=1 and min(method)='transfer' and min(receipt_number) is not null from public.customer_payments),'Retry duplicated receipt');
select pg_temp.ok((select amount=2000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000009201'),'Retry deducted twice');
do $$begin
  begin
    perform public.record_payment('20000000-0000-4000-8000-000000009201','10000000-0000-4000-8000-000000009201',3000,'2026-09-28','cash');
    raise exception 'Changed method accepted';
  exception when invalid_parameter_value then null; end;
end$$;
select pg_temp.ok((select (public.verify_receipt(verification_token)->>'amount')::int=3000 from public.customer_payments limit 1),'Verification amount differs');
select pg_temp.ok((select public.verify_receipt(verification_token) ? 'phone' = false from public.customer_payments limit 1),'Phone leaked');
select pg_temp.ok(public.verify_receipt('00000000-0000-4000-8000-000000009209') is null,'Unknown token resolved');
select pg_temp.ok((public.manager_snapshot('2026-09-28')->>'received')::int=3000,'Received total is incorrect');
select pg_temp.ok((public.store_activity('2026-09-28','2026-09-28',null,'payment',30,0)->>'received')::int=3000,'Activity total is incorrect');
reset role;
update public.customer_payments set receipt_status='voided' where request_id='20000000-0000-4000-8000-000000009201';
select set_config('app.test_receipt_token',(select verification_token::text from public.customer_payments limit 1),true);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(public.verify_receipt(current_setting('app.test_receipt_token')::uuid)->>'status'='voided','Voided status hidden');
do $$begin
  begin perform public.manager_snapshot('2026-09-28'); raise exception 'Anonymous snapshot accepted';
  exception when insufficient_privilege then null; end;
end$$;
rollback;
