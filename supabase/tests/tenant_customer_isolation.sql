-- M2e-2: two new owners can edit the SAME customers table, but never
-- each other's rows, and the original pilot owner cannot read either.
-- This test is disposable and rolls back. No public registration is enabled.
begin;

insert into auth.users(id) values
 ('89300000-0000-4000-8000-000000000001'),
 ('89300000-0000-4000-8000-000000000002'),
 ('89300000-0000-4000-8000-000000000003'),
 ('89300000-0000-4000-8000-000000000004');
insert into private.shop_owner(user_id)
values ('89300000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000001',true);
insert into public.customers(id,name,phone)
values ('89300000-0000-4000-9000-000000000011',
 'Original shop customer','08012340011');

do $before_gate$
begin
 if (select count(*) from public.customers)<>1 then
   raise exception 'Legacy owner lost preactivation customers';
 end if;
 if (select count(*) from public.customers where business_id is null)<>1 then
   raise exception 'Legacy customer got an unapproved business tag';
 end if;
end;
$before_gate$;
reset role;

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());

-- The existing shop must remain usable while a separately reviewed
-- backfill transaction has committed but write-gate activation is pending.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000001',true);
do $between_backfill_and_activation$
begin
 if (select count(*) from public.customers where
       id='89300000-0000-4000-9000-000000000011')<>1
    or (select count(*) from public.customers where business_id is null)<>0 then
   raise exception 'Existing owner lost tagged customers before activation';
 end if;
end;
$between_backfill_and_activation$;
reset role;

do $validate_tenant_fk$
declare r record;v_count integer:=0;
begin
 for r in select ns.nspname schema_name,cls.relname table_name,c.conname
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
 if v_count<>31 then
   raise exception 'Cannot activate legacy scope without all 31 FKs';
 end if;
end;
$validate_tenant_fk$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

-- Only after activation, set up independent empty depots.
insert into private.businesses(id,status) values
 ('89300000-0000-4000-9000-000000000021','setup'),
 ('89300000-0000-4000-9000-000000000022','active'),
 ('89300000-0000-4000-9000-000000000023','suspended');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89300000-0000-4000-9000-000000000021',
  '89300000-0000-4000-8000-000000000002','active','owner'),
 ('89300000-0000-4000-9000-000000000022',
  '89300000-0000-4000-8000-000000000003','active','owner'),
 ('89300000-0000-4000-9000-000000000023',
  '89300000-0000-4000-8000-000000000004','active','owner');

create function pg_temp.assert_true(p_test boolean,p_reason text)
returns void language plpgsql as $$
begin if p_test is distinct from true then
 raise exception '%',p_reason;end if; end;
$$;

do $grant_guard$
begin
 if not has_column_privilege('authenticated',
   'public.customers','business_id','INSERT')
   or has_column_privilege('authenticated',
   'public.customers','business_id','UPDATE')
   or has_column_privilege('authenticated',
   'public.customers','created_at','INSERT')
   or has_table_privilege('authenticated','public.customers','DELETE')
   or has_table_privilege('anon','public.customers','SELECT') then
   raise exception 'Customer grants permit identity mutation or unauthenticated reads';
 end if;
end;
$grant_guard$;

-- Owner A can insert and edit only A customers.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(
 private.can_manage_new_customer('89300000-0000-4000-9000-000000000021'),
 'Business A owner denied after activation');
insert into public.customers(id,name,phone,business_id)
values('89300000-0000-4000-9000-000000000031',
 'A customer','08012340031',
 '89300000-0000-4000-9000-000000000021');
update public.customers set name='A customer updated'
where id='89300000-0000-4000-9000-000000000031';
select pg_temp.assert_true(
 (select count(*)=1 from public.customers)
 and (select name='A customer updated' from public.customers
      where id='89300000-0000-4000-9000-000000000031')
 and not public.is_shop_owner(),
 'New shop A saw legacy data or could not edit own customer');

do $forgery_a$
declare changed integer;
begin
 begin
   insert into public.customers(id,name,phone,business_id)
   values ('89300000-0000-4000-9000-000000000032',
     'Forged B customer','08012340032',
     '89300000-0000-4000-9000-000000000022');
   raise exception 'Business A inserted B customer' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   insert into public.customers(id,name,phone)
   values ('89300000-0000-4000-9000-000000000033',
     'Unassigned customer','08012340033');
   raise exception 'Business A inserted unassigned legacy customer'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   update public.customers set business_id=
     '89300000-0000-4000-9000-000000000022'
   where id='89300000-0000-4000-9000-000000000031';
   raise exception 'Owner reassigned customer business_id' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 update public.customers set name='tampered legacy'
 where id='89300000-0000-4000-9000-000000000011';
 get diagnostics changed=row_count;
 if changed<>0 then
   raise exception 'Business A altered hidden legacy row';
 end if;
end;
$forgery_a$;
reset role;

-- Test the SERVER trigger itself in addition to the ordinary missing
-- UPDATE privilege. This is a transaction-local elevated grant, rolled back.
grant update(business_id) on public.customers to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000002',true);
do $trigger_reassignment_guard$
declare v_message text;
begin
 begin
   update public.customers
     set business_id='89300000-0000-4000-9000-000000000022'
   where id='89300000-0000-4000-9000-000000000031';
   raise exception 'Cross-business reassignment trigger was bypassed'
     using errcode='PT001';
 exception when insufficient_privilege then
   get stacked diagnostics v_message=message_text;
   if v_message<>'Customer business identity cannot be changed' then
     raise exception 'Unexpected reassignment failure: %',v_message;
   end if;
 end;
end;
$trigger_reassignment_guard$;
reset role;
revoke update(business_id) on public.customers from authenticated;

-- Owner B is independent of owner A and the original pilot.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000003',true);
insert into public.customers(id,name,phone,business_id)
values('89300000-0000-4000-9000-000000000041',
 'B customer','08012340041',
 '89300000-0000-4000-9000-000000000022');
select pg_temp.assert_true(
 (select count(*)=1 from public.customers)
 and (select name='B customer' from public.customers limit 1),
 'Business B saw A or legacy customers');
do $new_owner_rpc$
begin
 begin
   perform * from public.customer_account_snapshot(array[
       '89300000-0000-4000-9000-000000000011'::uuid,
       '89300000-0000-4000-9000-000000000041'::uuid
   ]);
   raise exception 'New owner could call legacy-only account RPC'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$new_owner_rpc$;
update public.customers set name='B customer updated'
where id='89300000-0000-4000-9000-000000000041';
reset role;

-- A new business cannot use the original owner's privileged reporting
-- APIs, even when requesting only its own customer.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000003',true);
do $new_owner_legacy_rpc$
begin
 begin
   perform public.customer_recent_activity(
     '89300000-0000-4000-9000-000000000041'::uuid);
   raise exception 'New-business owner accessed old report'
      using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$new_owner_legacy_rpc$;
reset role;

-- Disposable fixture representing a FUTURE properly tenant-tagged return.
-- Customer/return financial RPCs are NOT open to new owners yet; temporarily
-- disable ONLY this write trigger as the test administrator to seed a foreign
-- business return without granting a real checkout/return capability.
-- Re-enable immediately, and roll the entire fixture back after assertions.
alter table private.customer_empty_returns
  disable trigger legacy_scope_business_write;
insert into private.customer_empty_returns(
  request_id,customer_id,business_id,request_payload
) values(
 '89300000-0000-4000-9000-000000000051',
 '89300000-0000-4000-9000-000000000041',
 '89300000-0000-4000-9000-000000000022',
 '{"crates":[],"bottles":[{"bottleType":"Life","quantity":2}],"released":[]}'::jsonb
);
alter table private.customer_empty_returns
  enable trigger legacy_scope_business_write;

-- Create a real legacy return as the verified pilot owner so positive legacy
-- reporting is exercised alongside the foreign-business rejection.
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000001',true);
insert into private.customer_empty_returns(
  request_id,customer_id,request_payload
) values(
 '89300000-0000-4000-9000-000000000052',
 '89300000-0000-4000-9000-000000000011',
 '{"crates":[],"bottles":[{"bottleType":"Goldberg","quantity":1}],"released":[]}'::jsonb
);
set local role authenticated;
do $legacy_report_boundary$
declare
  v_foreign uuid:='89300000-0000-4000-9000-000000000051';
  v_foreign_customer uuid:='89300000-0000-4000-9000-000000000041';
  v_legacy uuid:='89300000-0000-4000-9000-000000000052';
  v_today date:=(now() at time zone 'Africa/Lagos')::date;
  v_recent jsonb;
  v_records jsonb;
  v_store jsonb;
  v_leg_record jsonb;
begin
  if public.customer_return_record(v_foreign) is not null then
    raise exception 'Legacy owner can retrieve foreign business return';
  end if;
  v_recent:=public.customer_recent_activity(v_foreign_customer);
  if v_recent->'items' is distinct from '[]'::jsonb then
    raise exception 'Foreign customer events leaked through recent activity: %',
      v_recent;
  end if;
  v_records:=public.customer_records(
    v_today-1,v_today+1,'all','all','',100,null,false);
  if pg_catalog.strpos(v_records::text,'B customer updated')<>0
    or pg_catalog.strpos(v_records::text,v_foreign::text)<>0 then
    raise exception 'Foreign customer leaked through records hub';
  end if;
  v_store:=public.store_activity(
    v_today-1,v_today+1,null,'all',100,0);
  if pg_catalog.strpos(v_store::text,'B customer updated')<>0
    or pg_catalog.strpos(v_store::text,v_foreign::text)<>0 then
    raise exception 'Foreign customer leaked through store activity';
  end if;
  v_leg_record:=public.customer_return_record(v_legacy);
  if v_leg_record is null
    or v_leg_record->>'customer_name'<>'Original shop customer'
    or v_leg_record->'bottles'->0->>'name'<>'Goldberg' then
    raise exception 'Legitimate original shop return was blocked: %',
      v_leg_record;
  end if;
end;
$legacy_report_boundary$;
reset role;

-- The old shop still sees only its original tagged customer, and its
-- previously permitted post-backfill editing continues.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(
 (select count(*)=1 from public.customers) and
 (select name='Original shop customer' from public.customers limit 1),
 'Legacy owner saw A/B rows or lost its own customer');
-- SECURITY DEFINER bypasses the table's RLS. The old owner can provide
-- arbitrary customer UUIDs, but its financial snapshot must return ONLY
-- the original shop customer even when the supplied array contains A/B.
select pg_temp.assert_true(
 (select count(*)=1 from public.customer_account_snapshot(array[
   '89300000-0000-4000-9000-000000000011'::uuid,
   '89300000-0000-4000-9000-000000000031'::uuid,
   '89300000-0000-4000-9000-000000000041'::uuid
 ]))
 and (select customer_id='89300000-0000-4000-9000-000000000011'::uuid
      from public.customer_account_snapshot(array[
      '89300000-0000-4000-9000-000000000011'::uuid,
      '89300000-0000-4000-9000-000000000031'::uuid,
      '89300000-0000-4000-9000-000000000041'::uuid
      ]) limit 1),
 'Privileged legacy customer-account RPC leaked another shop customer');
update public.customers set name='Original customer updated'
where id='89300000-0000-4000-9000-000000000011';
reset role;

-- Membership revocation should hide the customer's entire history,
-- not migrate/delete/mutate it.
update private.business_memberships set status='disabled'
 where business_id='89300000-0000-4000-9000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(
 not exists(select 1 from public.customers)
 and not private.can_manage_new_customer(
 '89300000-0000-4000-9000-000000000021'),
 'Revoked owner can still query customers');
do $revoked$
begin
 begin
  insert into public.customers(id,name,phone,business_id)
  values ('89300000-0000-4000-9000-000000000034',
     'Suspended owner write','08012340034',
     '89300000-0000-4000-9000-000000000021');
  raise exception 'Revoked owner created customer' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$revoked$;
reset role;

-- A suspended business is denied even if its membership is still active.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89300000-0000-4000-8000-000000000004',true);
do $suspended$
begin
 begin
  insert into public.customers(id,name,phone,business_id)
  values('89300000-0000-4000-9000-000000000043',
    'Suspended business customer','08012340043',
    '89300000-0000-4000-9000-000000000023');
  raise exception 'Suspended shop created customer' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$suspended$;
reset role;

do $reconcile$
declare old_business uuid;
begin
 select id into strict old_business from private.businesses
 where legacy_singleton is true;
 if (select count(*) from public.customers)<>3
   or (select count(*) from public.customers where business_id=old_business)<>1
   or (select count(*) from public.customers where business_id=
       '89300000-0000-4000-9000-000000000021')<>1
   or (select count(*) from public.customers where business_id=
       '89300000-0000-4000-9000-000000000022')<>1
   or (select count(*) from public.customers where business_id is null)<>0
   or (select name from public.customers
       where id='89300000-0000-4000-9000-000000000011')<>'Original customer updated'
   or (select name from public.customers
       where id='89300000-0000-4000-9000-000000000031')<>'A customer updated'
   or (select name from public.customers
       where id='89300000-0000-4000-9000-000000000041')<>'B customer updated' then
     raise exception 'Cross-business customer update or leak affected persisted rows';
 end if;
end;
$reconcile$;
rollback;
