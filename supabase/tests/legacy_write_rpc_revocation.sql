-- M2 legacy write API audit. All fixture records and membership revocation
-- are disposable. Proves authorization comes BEFORE balance lookups, receipt
-- replay, parameter validation, stock existence and saved-sale probing.
begin;
insert into auth.users(id) values
 ('89500000-0000-4000-8000-000000000001'),
 ('89500000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('89500000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.customers(id,name,phone)
values('89500000-0000-4000-9000-000000000011',
       'Authorized repayment customer','08000895011');
insert into public.money_owed(customer_id,amount)
values('89500000-0000-4000-9000-000000000011',12000);

-- Audit ALL current SECURITY DEFINER singleton owner references. The only
-- intentional exception is the INTERNAL row-history trigger which is not
-- callable as an API endpoint. Helper-based entrypoints are already guarded
-- by the existing is_shop_owner() implementation.
do $definition_audit$
declare r record; v_uncertain integer; v_unguarded text;
begin
 select count(*) into v_uncertain
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and p.prosecdef
 and pg_get_functiondef(p.oid) like '%private.shop_owner%'
 and pg_get_functiondef(p.oid) not like '%private.verified_legacy_owner_read()%'
 and not (n.nspname='private' and (
      (p.proname='record_product_selling_price'
       and p.prorettype='trigger'::regtype)
   or (p.proname='scope_legacy_operational_write'
       and p.prorettype='trigger'::regtype
       and pg_get_functiondef(p.oid) like '%private.business_memberships%')
   or (p.proname='verified_legacy_owner_read'
       and p.prorettype='boolean'::regtype
       and pg_get_functiondef(p.oid) like '%private.business_memberships%')
  ));
 if v_uncertain<>0 then
   select string_agg(p.oid::regprocedure::text,', ') into v_unguarded
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('private','public') and p.prosecdef
     and pg_get_functiondef(p.oid) like '%private.shop_owner%'
     and pg_get_functiondef(p.oid) not like '%private.verified_legacy_owner_read()%'
     and not (n.nspname='private' and (
       (p.proname='record_product_selling_price' and p.prorettype='trigger'::regtype)
       or (p.proname='scope_legacy_operational_write'
           and p.prorettype='trigger'::regtype
           and pg_get_functiondef(p.oid) like '%private.business_memberships%')
       or (p.proname='verified_legacy_owner_read'
           and p.prorettype='boolean'::regtype
           and pg_get_functiondef(p.oid) like '%private.business_memberships%')
     ));
   raise exception 'Unprotected privileged singleton API count: %; routines: %',
     v_uncertain,v_unguarded;
 end if;
 for r in
   select p.oid, p.oid::regprocedure as signature
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in('public','private') and p.prosecdef
   and pg_get_functiondef(p.oid) like '%private.shop_owner%'
   and pg_get_functiondef(p.oid) like '%private.verified_legacy_owner_read()%'
 loop
   if pg_catalog.strpos(pg_catalog.substr(
         pg_get_functiondef(r.oid),
         pg_catalog.strpos(pg_get_functiondef(r.oid),E'\nbegin\n'),210),
       E'\nbegin\n  if not private.verified_legacy_owner_read()')=0
      and r.signature::text not in (
       -- M2d-3 reporting + M2d-2 readers contain the verified check
       -- within the old guard itself rather than a separate preamble.
       'customer_account_snapshot(uuid[])',
       'customer_recent_activity(uuid)',
       'customer_records(date,date,text,text,text,integer,jsonb,boolean)',
       'customer_return_record(uuid)',
       'manager_snapshot(date)',
       'store_activity(date,date,uuid,text,integer,integer)',
       'set_shop_drink_active(uuid,boolean,boolean)'
      ) then
        raise exception 'Authorization not at entrypoint start: %',r.signature;
   end if;
 end loop;
end;
$definition_audit$;

-- Original owner can use the ordinary payment API with the same semantics
-- before and after legacy gate activation.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89500000-0000-4000-8000-000000000001',true);
do $owner_pre_gate$
declare v_receipt jsonb;
begin
 v_receipt:=public.record_payment(
  '89500000-0000-4000-9000-000000000021',
  '89500000-0000-4000-9000-000000000011',5000,
  '2026-10-15'::date,'cash');
 if (v_receipt->>'owing')::int<>7000
  or (v_receipt->>'amount')::int<>5000 then
   raise exception 'Legacy payment calculation was damaged: %',v_receipt;
 end if;
end;
$owner_pre_gate$;
reset role;

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record; v_count integer:=0;
begin
 for r in
  select ns.nspname schema_name,cls.relname table_name,c.conname
  from pg_constraint c
  join pg_class cls on cls.oid=c.conrelid
  join pg_namespace ns on ns.oid=cls.relnamespace
  join private.legacy_scope_tables() t
   on t.schema_name=ns.nspname and t.table_name=cls.relname
  where c.contype='f' and left(c.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',
    r.schema_name,r.table_name,r.conname);
  v_count:=v_count+1;
 end loop;
 if v_count<>31 then raise exception 'Incomplete tenant FKs: %',v_count; end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89500000-0000-4000-8000-000000000001',true);
do $owner_active$
declare r jsonb;
begin
 r:=public.record_payment(
  '89500000-0000-4000-9000-000000000021',
  '89500000-0000-4000-9000-000000000011',5000,
  '2026-10-15'::date,'cash');
 if (r->>'owing')::int<>7000 then
  raise exception 'Active owner lost payment idempotence: %',r;
 end if;
end;
$owner_active$;
reset role;

update private.business_memberships set status='disabled'
where user_id='89500000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89500000-0000-4000-8000-000000000001',true);
do $revoked_owner$
declare v_id uuid:='89500000-0000-4000-9000-000000000011'; r jsonb;
begin
 -- Replay of a COMMITTED payment must not divulge its original details.
 begin
  r:=public.record_payment(
   '89500000-0000-4000-9000-000000000021',v_id,5000,
   '2026-10-15','cash');
  raise exception 'Revoked owner recovered payment: %',r using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 -- A new attempt must be rejected BEFORE comparing amount against 7000 owed.
 begin
  r:=public.record_payment(
   '89500000-0000-4000-9000-000000000022',v_id,9000,
   '2026-10-15','cash');
  raise exception 'Revoked owner probed exact balance: %',r using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 -- Unknown customer and malformed stock attempts must produce the same
 -- access-denied class, not not-found/invalid-stock information.
 begin
  r:=public.record_payment(
   '89500000-0000-4000-9000-000000000023',
   '89500000-0000-4000-9000-000000000099',100,
   '2026-10-15','cash');
  raise exception 'Revoked owner probed customer existence: %',r using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
  perform private.receive_stock(
   null,null,null,null,null,null,null,null);
  raise exception 'Revoked owner accessed stock RPC validation'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
  perform private.set_bottle_deposit_price(125::numeric);
  raise exception 'Revoked owner reached deposit configuration'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.save_sale_v2(
   null,null,null,null,null,null,null,null);
  raise exception 'Revoked owner entered sale RPC'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$revoked_owner$;

select set_config('request.jwt.claim.sub',
 '89500000-0000-4000-8000-000000000002',true);
do $outsider$
begin
 begin
  perform public.record_payment(
   '89500000-0000-4000-9000-000000000021',
   '89500000-0000-4000-9000-000000000011',
   5000,'2026-10-15','cash');
  raise exception 'Other user replayed legacy payment' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$outsider$;
reset role;

-- Revocation changes permissions, not historic financial data.
do $financial_integrity$
begin
 if (select amount from public.money_owed
      where customer_id='89500000-0000-4000-9000-000000000011')<>7000
    or (select count(*) from public.customer_payments
        where request_id='89500000-0000-4000-9000-000000000021')<>1
    or (select amount from public.customer_payments
        where request_id='89500000-0000-4000-9000-000000000021')<>5000 then
   raise exception 'Access revocation altered or duplicated ledger values';
 end if;
end;
$financial_integrity$;
rollback;
