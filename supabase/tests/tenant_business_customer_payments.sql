-- M2: tenant-safe customer debt payment writer.
-- Disposable PostgreSQL only. All setup and writes roll back.
begin;

insert into auth.users(id) values
 ('91000000-0000-4000-8000-000000000001'),
 ('91000000-0000-4000-8000-000000000002'),
 ('91000000-0000-4000-8000-000000000003');

insert into private.shop_owner(user_id)
values ('91000000-0000-4000-8000-000000000001');

insert into private.businesses(id,status,legacy_singleton) values
 ('91000000-0000-4000-9000-000000000001','active',true),
 ('91000000-0000-4000-9000-000000000011','setup',null),
 ('91000000-0000-4000-9000-000000000022','setup',null);

insert into private.business_memberships(business_id,user_id,member_kind,status) values
 ('91000000-0000-4000-9000-000000000001','91000000-0000-4000-8000-000000000001','owner','active'),
 ('91000000-0000-4000-9000-000000000011','91000000-0000-4000-8000-000000000002','owner','active'),
 ('91000000-0000-4000-9000-000000000022','91000000-0000-4000-8000-000000000003','owner','active');

insert into public.business_profiles(business_id,name,address,phone) values
 ('91000000-0000-4000-9000-000000000011','Payment Depot A','Lagos','08000000011'),
 ('91000000-0000-4000-9000-000000000022','Payment Depot B','Abuja','08000000022');

-- Disposable test gates only. The legacy gate is enabled here solely so
-- the existing M2 customer RLS and operational guard can be exercised.
insert into private.legacy_write_scope_gate(singleton,business_id,enabled,enabled_at)
values(true,'91000000-0000-4000-9000-000000000001',true,pg_catalog.now());
update private.business_customer_registration_gate set enabled=true;
update private.business_customer_opening_gate set enabled=true;
update private.business_customer_payment_gate set enabled=true;

select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000002',true);
insert into public.customers(id,name,phone,business_id) values
 ('92000000-0000-4000-8000-000000000011','A Customer','08000000011',
  '91000000-0000-4000-9000-000000000011');
insert into public.money_owed(customer_id,amount,business_id) values
 ('92000000-0000-4000-8000-000000000011',8000,
  '91000000-0000-4000-9000-000000000011');

select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000003',true);
insert into public.customers(id,name,phone,business_id) values
 ('92000000-0000-4000-8000-000000000022','B Customer','08000000022',
  '91000000-0000-4000-9000-000000000022');
insert into public.money_owed(customer_id,amount,business_id) values
 ('92000000-0000-4000-8000-000000000022',5000,
  '91000000-0000-4000-9000-000000000022');

update private.businesses set status='active'
where id in (
 '91000000-0000-4000-9000-000000000011',
 '91000000-0000-4000-9000-000000000022'
);

create function pg_temp.ok(v boolean,msg text)
returns void language plpgsql as $$
begin
 if v is distinct from true then raise exception '%',msg; end if;
end $$;

-- Feature gate OFF must fail closed before exposing a saved request.
update private.business_customer_payment_gate set enabled=false;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000002',true);

do $$begin
 begin
  perform public.record_business_customer_payment(
   '91000000-0000-4000-9000-000000000011',
   '93000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000011',
   2000,'2026-11-15','cash');
  raise exception 'Payment gate OFF was accepted';
 exception when insufficient_privilege then null;
 end;
end$$;
reset role;

update private.business_customer_payment_gate set enabled=true;

-- The write trigger must not permit a balance reduction without a matching
-- immutable payment row, even when an owner identity is present.
select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000002',true);
do $balance_guard$
begin
 begin
  update public.money_owed set amount=4000
   where customer_id='92000000-0000-4000-8000-000000000011'
     and business_id='91000000-0000-4000-9000-000000000011';
  raise exception 'Unmatched balance reduction was accepted';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.money_owed set amount=9000
   where customer_id='92000000-0000-4000-8000-000000000011'
     and business_id='91000000-0000-4000-9000-000000000011';
  raise exception 'Balance increase was accepted by payment-only guard';
 exception when insufficient_privilege then null;
 end;
end;
$balance_guard$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000002',true);

do $payment_a$
declare v jsonb; r jsonb; token uuid;
begin
 v:=public.record_business_customer_payment(
  '91000000-0000-4000-9000-000000000011',
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000011',
  3000,'2026-11-15','cash');
 if v->>'amount'<>'3000' or v->>'owing'<>'5000'
    or v->>'savedReplay'<>'false' then
  raise exception 'A payment result incorrect: %',v;
 end if;
 r:=public.record_business_customer_payment(
  '91000000-0000-4000-9000-000000000011',
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000011',
  3000,'2026-11-15','cash');
 if r->>'paymentId'<>v->>'paymentId'
    or r->>'savedReplay'<>'true'
    or r->>'owing'<>'5000' then
  raise exception 'A retry was not an immutable replay: %',r;
 end if;
 begin
  perform public.record_business_customer_payment(
   '91000000-0000-4000-9000-000000000011',
   '93000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000011',
   4000,'2026-11-15','cash');
  raise exception 'Changed payment replay was accepted';
 exception when invalid_parameter_value then null;
 end;
 token:=(v->>'verificationToken')::uuid;
 if public.verify_receipt(token)->'business'->>'name'<>'Payment Depot A'
    or public.verify_receipt(token)->>'customer'<>'A Customer'
    or public.verify_receipt(token)->>'amount'<>'3000' then
  raise exception 'Receipt did not freeze the correct business/customer: %',
    public.verify_receipt(token);
 end if;
end;
$payment_a$;

-- Same request UUID is independent across businesses.
select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000003',true);
do $payment_b$
declare v jsonb;
begin
 v:=public.record_business_customer_payment(
  '91000000-0000-4000-9000-000000000022',
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000022',
  2000,'2026-11-15','transfer');
 if v->>'amount'<>'2000' or v->>'owing'<>'3000'
    or v->>'savedReplay'<>'false' then
  raise exception 'B payment collided with A request: %',v;
 end if;
end;
$payment_b$;

-- A cannot use B's business/customer identifiers.
select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000002',true);
do $foreign_owner$
begin
 begin
  perform public.record_business_customer_payment(
   '91000000-0000-4000-9000-000000000022',
   '93000000-0000-4000-8000-000000000002',
   '92000000-0000-4000-8000-000000000022',
   1000,'2026-11-15','cash');
  raise exception 'A paid B customer';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.record_business_customer_payment(
   '91000000-0000-4000-9000-000000000011',
   '93000000-0000-4000-8000-000000000003',
   '92000000-0000-4000-8000-000000000011',
   9000,'2026-11-15','cash');
  raise exception 'Overpayment was accepted';
 exception when invalid_parameter_value then null;
 end;
end;
$foreign_owner$;

reset role;

select pg_temp.ok(
 (select amount=5000 from public.money_owed
  where customer_id='92000000-0000-4000-8000-000000000011'
    and business_id='91000000-0000-4000-9000-000000000011'),
 'A balance incorrect after payment/retry');
select pg_temp.ok(
 (select amount=3000 from public.money_owed
  where customer_id='92000000-0000-4000-8000-000000000022'
    and business_id='91000000-0000-4000-9000-000000000022'),
 'B balance incorrect after payment');

-- Payment history is tenant-scoped at the read boundary too.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
 '91000000-0000-4000-8000-000000000002',true);
select pg_temp.ok(
 (select count(*)=1 from public.customer_payments
  where business_id='91000000-0000-4000-9000-000000000011'),
 'A cannot read own payment');
select pg_temp.ok(
 (select count(*)=0 from public.customer_payments
  where business_id='91000000-0000-4000-9000-000000000022'),
 'A can read B payment');
reset role;

set local role anon;
do $$begin
 begin
  perform public.record_business_customer_payment(
   '91000000-0000-4000-9000-000000000011',
   '93000000-0000-4000-8000-000000000004',
   '92000000-0000-4000-8000-000000000011',
   1000,'2026-11-15','cash');
  raise exception 'Anonymous caller wrote a payment';
 exception when insufficient_privilege then null;
 end;
end$$;
reset role;

select pg_temp.ok(
 not has_function_privilege('anon',
  'public.record_business_customer_payment(uuid,uuid,uuid,numeric,date,text)','EXECUTE')
 and has_function_privilege('authenticated',
  'public.record_business_customer_payment(uuid,uuid,uuid,numeric,date,text)','EXECUTE'),
 'RPC execution grants are not restricted to authenticated owners');

select pg_temp.ok(
 not has_table_privilege('authenticated','public.customer_payments','INSERT')
 and not has_table_privilege('authenticated','public.customer_payments','UPDATE')
 and not has_table_privilege('authenticated','public.money_owed','UPDATE'),
 'Payment rollout granted direct client table writes');

rollback;
