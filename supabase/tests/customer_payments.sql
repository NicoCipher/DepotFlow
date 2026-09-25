-- Disposable migrated database only. Every fixture and failure trigger rolls back.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000051'),
  ('00000000-0000-4000-8000-000000000052');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000051');
insert into public.customers(id,name,phone) values
  ('10000000-0000-4000-8000-000000000051','Pay Test','+2348030000051');
insert into public.money_owed(customer_id,amount) values
  ('10000000-0000-4000-8000-000000000051',20000);
-- A pre-existing historical sale: payments must never touch its stored totals.
insert into public.sales(id,customer_id,total_amount,paid_amount) values
  ('40000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',15000,5000);
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000051',true);

-- A normal payment reduces money owed and writes one ledger row; the old sale is untouched.
select public.record_payment('20000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',8000,'2026-01-05');
select pg_temp.check_true((select amount=12000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000051'),'Payment did not reduce money owed');
select pg_temp.check_true((select count(*)=1 from public.customer_payments where request_id='20000000-0000-4000-8000-000000000051'),'Payment not recorded once');
select pg_temp.check_true((select amount=8000 and owed_after=12000 and business_date='2026-01-05' from public.customer_payments where request_id='20000000-0000-4000-8000-000000000051'),'Wrong payment ledger row');
select pg_temp.check_true((select total_amount=15000 and paid_amount=5000 from public.sales where id='40000000-0000-4000-8000-000000000051'),'Payment altered a historical sale');

-- Retrying the identical form is a no-op: no duplicate row, no double deduction.
select public.record_payment('20000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',8000,'2026-01-05');
select pg_temp.check_true((select count(*)=1 from public.customer_payments where request_id='20000000-0000-4000-8000-000000000051'),'Retry duplicated the ledger');
select pg_temp.check_true((select amount=12000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000051'),'Retry deducted twice');

-- Retrying the same request ID with different details is rejected, not silently replayed.
do $$ begin
  begin
    perform public.record_payment('20000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',9000,'2026-01-05');
    raise exception 'Changed amount retry accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_payment('20000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',8000,'2026-01-06');
    raise exception 'Changed date retry accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- Zero, negative, decimal, non-finite, null, and overflowing amounts are all rejected.
do $$ declare n numeric; d date; begin
  foreach n in array array[-1,0,0.5,2147483648,'NaN'::numeric,'Infinity'::numeric,null] loop
    begin
      perform public.record_payment(gen_random_uuid(),'10000000-0000-4000-8000-000000000051',n,'2026-01-07');
      raise exception 'Invalid amount accepted: %',n;
    exception when invalid_parameter_value then null; end;
  end loop;
  foreach d in array array[null,'infinity'::date,'-infinity'::date,'10000-01-01'::date] loop
    begin
      perform public.record_payment(gen_random_uuid(),'10000000-0000-4000-8000-000000000051',100,d);
      raise exception 'Invalid business date accepted: %',d;
    exception when invalid_parameter_value then null; end;
  end loop;
  -- Overpayment against the current (locked) balance of 12000 is rejected and changes nothing.
  begin
    perform public.record_payment(gen_random_uuid(),'10000000-0000-4000-8000-000000000051',20000,'2026-01-07');
    raise exception 'Overpayment accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.check_true((select amount=12000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000051'),'Rejected payment attempt still changed the balance');
select pg_temp.check_true((select count(*)=1 from public.customer_payments),'Rejected payment attempt was recorded');

-- Paying the remaining balance down to exactly zero is allowed.
select public.record_payment('20000000-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000051',12000,'2026-01-08');
select pg_temp.check_true((select amount=0 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000051'),'Full settlement left a balance');

-- A payment is rejected once the customer owes nothing.
do $$ begin
  begin
    perform public.record_payment(gen_random_uuid(),'10000000-0000-4000-8000-000000000051',500,'2026-01-09');
    raise exception 'Payment accepted with zero debt';
  exception when invalid_parameter_value then null; end;
end $$;

-- The ledger is immutable: no update/delete/direct-insert grants exist for the owner.
do $$ begin
  begin
    update public.customer_payments set amount=1;
    raise exception 'Ledger update permitted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.customer_payments;
    raise exception 'Ledger delete permitted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.customer_payments(customer_id,amount,owed_after,business_date,request_id)
      values ('10000000-0000-4000-8000-000000000051',1,0,'2026-01-09',gen_random_uuid());
    raise exception 'Direct ledger insert permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform private.record_payment(gen_random_uuid(),'10000000-0000-4000-8000-000000000051',1,'2026-01-09');
    raise exception 'Private payment function bypassed owner wrapper';
  exception when insufficient_privilege then null; end;
end $$;

-- A failure while writing the ledger must roll back the balance deduction too.
reset role;
update public.money_owed set amount=5000 where customer_id='10000000-0000-4000-8000-000000000051';
create function pg_temp.fail_ledger() returns trigger language plpgsql as $$ begin raise exception using errcode='23514',message='forced ledger failure'; end $$;
create trigger payment_test_failure before insert on public.customer_payments for each row execute function pg_temp.fail_ledger();
set local role authenticated;
do $$ begin
  begin
    perform public.record_payment('20000000-0000-4000-8000-000000000053','10000000-0000-4000-8000-000000000051',2000,'2026-01-10');
    raise exception 'Expected ledger failure';
  exception when check_violation then null; end;
end $$;
select pg_temp.check_true((select amount=5000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000051'),'Failed payment left changed balance');
select pg_temp.check_true(not exists(select 1 from public.customer_payments where request_id='20000000-0000-4000-8000-000000000053'),'Failed payment persisted a ledger row');
reset role;
drop trigger payment_test_failure on public.customer_payments;
set local role authenticated;
select public.record_payment('20000000-0000-4000-8000-000000000053','10000000-0000-4000-8000-000000000051',2000,'2026-01-10');
select pg_temp.check_true((select amount=3000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000051'),'Normal payment failed after trigger removal');

-- Non-owner: cannot record payments, cannot read the ledger.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000052',true);
do $$ begin
  begin
    perform public.record_payment(gen_random_uuid(),'10000000-0000-4000-8000-000000000051',1,'2026-01-11');
    raise exception 'Non-owner recorded a payment';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.check_true(not exists(select 1 from public.customer_payments),'Non-owner read the payment ledger');

-- Anonymous: same, plus no table access at all.
set local role anon;
do $$ begin
  begin
    perform public.record_payment(gen_random_uuid(),'10000000-0000-4000-8000-000000000051',1,'2026-01-11');
    raise exception 'Anonymous recorded a payment';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.customer_payments;
    raise exception 'Anonymous read the payment ledger';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.check_true((select relrowsecurity from pg_class where oid='public.customer_payments'::regclass),'Missing ledger RLS');
select pg_temp.check_true(not has_table_privilege('authenticated','public.customer_payments','INSERT,UPDATE,DELETE'),'Unexpected ledger write grant');
rollback;
