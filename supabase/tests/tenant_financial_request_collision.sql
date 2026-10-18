-- Cross-tenant financial request UUID collision acceptance.
-- Two shops can independently use the SAME UUID; replay, receipts and
-- Check Sale must resolve only the verified original business.
-- Disposable tests only: never fabricates financial records in production.
begin;

insert into auth.users(id) values
 ('89c00000-0000-4000-8000-000000000001'),
 ('89c00000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
 values('89c00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.customers(id,name,phone) values(
 '89c00000-0000-4000-9000-000000000011',
 'Legacy payment test buyer','08000890011');
insert into public.money_owed(customer_id,amount) values(
 '89c00000-0000-4000-9000-000000000011',1000);

-- Required audited activation of the original shop before provisioning B.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate_fks$
declare r record; n integer:=0;
begin
 for r in select ns.nspname s,c.relname t,k.conname
   from pg_constraint k join pg_class c on c.oid=k.conrelid
   join pg_namespace ns on ns.oid=c.relnamespace
   join private.legacy_scope_tables() tab
     on tab.schema_name=ns.nspname and tab.table_name=c.relname
   where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Missing scoped FK count %',n;end if;
end;
$validate_fks$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());
insert into private.businesses(id,status)
 values('89c00000-0000-4000-9000-000000000021','active');
insert into private.business_memberships(business_id,user_id,status,member_kind)
 values('89c00000-0000-4000-9000-000000000021',
        '89c00000-0000-4000-8000-000000000002','active','owner');
-- Rollback-only financial fixture: temporarily restore legacy tenant
-- INSERT(business_id) solely to create a foreign customer for testing
-- older privileged financial RPC isolation. Never in production.
grant insert(business_id) on public.customers to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89c00000-0000-4000-8000-000000000002',true);
insert into public.customers(id,name,phone,business_id)
 values('89c00000-0000-4000-9000-000000000022',
 'Foreign debtor','08000890022',
 '89c00000-0000-4000-9000-000000000021');
reset role;
revoke insert(business_id) on public.customers from authenticated;

-- The foreign financial rows are fixture-only superuser inserts. The new
-- owner is NOT permitted to record sales, stock, payment or empty returns.
-- Disposable superuser fixtures only: bypass writes' triggers without
-- ALTER TABLE, which is unsafe with queued deferred receipt/tender events.
-- The new-business payment/sale RPC grants remain forbidden.
set local session_replication_role=replica;
insert into public.sales(
 customer_id,total_amount,paid_amount,business_date,
 request_id,request_payload,payment_method,business_id,
 receipt_customer_name,receipt_customer_name_source
) values(
 '89c00000-0000-4000-9000-000000000022',
 5000,0,'2026-10-17',
 '89c00000-0000-4000-9000-000000000091',
 '{}'::jsonb,'not_recorded',
 '89c00000-0000-4000-9000-000000000021',
 'Foreign debtor','captured'
);
insert into public.customer_payments(
 customer_id,amount,owed_after,business_date,request_id,method,business_id,
 receipt_customer_name,receipt_customer_name_source
) values(
 '89c00000-0000-4000-9000-000000000022',
 13,987,'2026-10-17',
 '89c00000-0000-4000-9000-000000000092',
 'transfer','89c00000-0000-4000-9000-000000000021',
 'Foreign debtor','captured'
);
-- Return immediately to normal trigger enforcement for all real
-- signed-in original-shop save and payment tests below.
set local session_replication_role=origin;

-- The original owner is allowed to use the same payment request UUID on
-- its OWN customer and must not rewrite the foreign method or balance.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89c00000-0000-4000-8000-000000000001',true);
do $original_payment$
declare
 v_first jsonb;
 v_second jsonb;
begin
 v_first:=public.record_payment(
   '89c00000-0000-4000-9000-000000000092',
   '89c00000-0000-4000-9000-000000000011',
   100,'2026-10-17','cash');
 v_second:=public.record_payment(
   '89c00000-0000-4000-9000-000000000092',
   '89c00000-0000-4000-9000-000000000011',
   100,'2026-10-17','cash');
 if v_second is distinct from v_first
     or (v_first->>'amount')::integer<>100
     or (select amount from public.money_owed
          where customer_id='89c00000-0000-4000-9000-000000000011')<>900 then
   raise exception 'Same-shop payment replay failed or charged twice: % / %',
     v_first,v_second;
 end if;
 if (select count(*) from public.customer_payments
      where request_id='89c00000-0000-4000-9000-000000000092')<>1
     or (select method from public.customer_payments
      where request_id='89c00000-0000-4000-9000-000000000092')<>'cash' then
   raise exception 'Legacy owner read foreign payment in own history';
 end if;
end;
$original_payment$;
reset role;

-- An existing foreign sale with the same request ID cannot block a normal
-- original-shop sale or force its read-only Check Sale to return "absent".
select set_config('request.jwt.claim.sub',
 '89c00000-0000-4000-8000-000000000001',true);
insert into public.sales(
 customer_id,total_amount,paid_amount,business_date,
 request_id,request_payload,payment_method
) values(
 '89c00000-0000-4000-9000-000000000011',
 1000,0,'2026-10-17',
 '89c00000-0000-4000-9000-000000000091',
 '{}'::jsonb,'not_recorded'
);
set local role authenticated;
do $original_recovery$
declare v jsonb;
begin
 v:=public.check_split_sale_request(
  '89c00000-0000-4000-9000-000000000091');
 if v->>'state'<>'different' then
   raise exception 'Check Sale chose foreign duplicate request: %',v;
 end if;
 if (select count(*) from public.sales
     where request_id='89c00000-0000-4000-9000-000000000091')<>1 then
   raise exception 'Original owner can see foreign sale with same UUID';
 end if;
end;
$original_recovery$;
reset role;

-- Cross-business inventory, ledger and historical receipt data unchanged.
do $independent_requests$
begin
 if (select count(*) from public.sales
      where request_id='89c00000-0000-4000-9000-000000000091')<>2
 or (select count(*) from public.customer_payments
      where request_id='89c00000-0000-4000-9000-000000000092')<>2
 or (select amount from public.customer_payments where business_id='89c00000-0000-4000-9000-000000000021'
     and request_id='89c00000-0000-4000-9000-000000000092')<>13
 or (select method from public.customer_payments where business_id='89c00000-0000-4000-9000-000000000021'
     and request_id='89c00000-0000-4000-9000-000000000092')<>'transfer'
 or (select count(*) from public.sales where business_id='89c00000-0000-4000-9000-000000000021')<>1
 or (select count(*) from public.customer_payments
     where business_id='89c00000-0000-4000-9000-000000000021')<>1 then
  raise exception 'Cross-business request collision corrupted immutable financial data';
 end if;
end;
$independent_requests$;

rollback;
