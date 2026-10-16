-- Schema-level regression for the as-yet-disabled split writer.
-- Runs only against disposable PostgreSQL in CI.
begin;

insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000009501'),
 ('00000000-0000-4000-8000-000000009502');
insert into private.shop_owner(user_id)
 values ('00000000-0000-4000-8000-000000009501');
insert into public.customers(id,name,phone)
 values ('20000000-0000-4000-8000-000000009501','Split Tender Test','08000009501');

create function pg_temp.assert_true(ok boolean, label text)
returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception '%', label; end if;
end $$;

-- A sale-only split has two independently immutable amounts.
insert into public.sales(
 id,customer_id,request_id,total_amount,paid_amount,business_date,payment_method,account_receipt
) values (
 '30000000-0000-4000-8000-000000009501',
 '20000000-0000-4000-8000-000000009501',
 '40000000-0000-4000-8000-000000009501',
 1700,1700,'2026-10-16','mixed',
 '{"paidOld":0,"paidSale":1700,"collected":1700}'::jsonb
);
insert into public.sale_tender_legs(sale_id,method,sale_amount,old_debt_amount)
values
 ('30000000-0000-4000-8000-000000009501','cash',700,0),
 ('30000000-0000-4000-8000-000000009501','transfer',1000,0);
set constraints all immediate;
select pg_temp.assert_true((
  select sum(sale_amount)=1700 and sum(old_debt_amount)=0 and count(*)=2
  from public.sale_tender_legs
  where sale_id='30000000-0000-4000-8000-000000009501'
),'Cash + transfer sale leg totals incorrect');
-- Subsequent setup also needs both legs present before deferred checks fire.
set constraints all deferred;

-- Combined sale and prior debt preserve exact method-level allocations.
insert into public.customer_payments(
 id,customer_id,request_id,amount,owed_after,business_date,method
) values (
 '50000000-0000-4000-8000-000000009501',
 '20000000-0000-4000-8000-000000009501',
 md5('depotflow:old-debt:' || '40000000-0000-4000-8000-000000009502')::uuid,
 500,0,'2026-10-16','mixed'
);
insert into public.sales(
 id,customer_id,request_id,total_amount,paid_amount,business_date,payment_method,account_receipt
) values (
 '30000000-0000-4000-8000-000000009502',
 '20000000-0000-4000-8000-000000009501',
 '40000000-0000-4000-8000-000000009502',
 1500,1500,'2026-10-16','mixed',
 '{"paidOld":500,"paidSale":1500,"collected":2000}'::jsonb
);
insert into public.sale_tender_legs(
 sale_id,method,sale_amount,old_debt_amount,old_debt_payment_id
) values
 ('30000000-0000-4000-8000-000000009502','cash',1000,200,
   '50000000-0000-4000-8000-000000009501'),
 ('30000000-0000-4000-8000-000000009502','transfer',500,300,
   '50000000-0000-4000-8000-000000009501');
select pg_temp.assert_true((
  select sum(sale_amount)=1500 and sum(old_debt_amount)=500 and count(*)=2
  from public.sale_tender_legs
  where sale_id='30000000-0000-4000-8000-000000009502'
),'Old-debt allocation or tender count incorrect');

-- Exact storage constraints, no zero rows, duplicate methods or missing links.
do $$ begin
  begin
    insert into public.sale_tender_legs(sale_id,method,sale_amount,old_debt_amount)
    values ('30000000-0000-4000-8000-000000009501','cash',3,0);
    raise exception 'Duplicate Cash leg was accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.sale_tender_legs(sale_id,method,sale_amount,old_debt_amount)
    values ('30000000-0000-4000-8000-000000009501','pos',1,0);
    raise exception 'Unsupported POS split leg was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.sale_tender_legs(sale_id,method,sale_amount,old_debt_amount)
    values ('30000000-0000-4000-8000-000000009501','cash',0,0);
    raise exception 'Zero leg was accepted';
  exception when check_violation or unique_violation then null; end;
  begin
    update public.sale_tender_legs set sale_amount=1
    where sale_id='30000000-0000-4000-8000-000000009501' and method='cash';
    raise exception 'An immutable tender was updated';
  exception when invalid_parameter_value then null; end;
  begin
    delete from public.sale_tender_legs
    where sale_id='30000000-0000-4000-8000-000000009501' and method='cash';
    raise exception 'An immutable tender was deleted';
  exception when invalid_parameter_value then null; end;
end $$;

select pg_temp.assert_true(
 not has_table_privilege('authenticated','public.sale_tender_legs','INSERT')
 and not has_table_privilege('authenticated','public.sale_tender_legs','UPDATE')
 and not has_table_privilege('authenticated','public.sale_tender_legs','DELETE'),
 'Authenticated user should not directly write immutable tender rows'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009501',true);
select pg_temp.assert_true((
 select count(*)=4 from public.sale_tender_legs
),'Owner must read tender rows for receipts');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009502',true);
select pg_temp.assert_true((
 select count(*)=0 from public.sale_tender_legs
),'Non-owner must not read tender details');

rollback;
