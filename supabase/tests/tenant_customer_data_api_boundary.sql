-- M2f-44: AUTHENTICATED Data API equivalent requests cannot supply
-- a new-depot business_id or caller-chosen foreign customer ID. Existing
-- Walnik legacy owner inserts, edits and views still function normally.
-- Disposable Postgres fixture; transaction ALWAYS rolled back.
begin;
insert into auth.users(id) values
 ('89c00000-0000-4000-8000-000000000001'),
 ('89c00000-0000-4000-8000-000000000002'),
 ('89c00000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values('89c00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

do $no_direct_business_insert$
begin
 if has_column_privilege('authenticated','public.customers','business_id','INSERT')
 or not has_column_privilege('authenticated','public.customers','id','INSERT')
 or not has_column_privilege('authenticated','public.customers','phone','INSERT')
 or has_table_privilege('anon','public.customers','INSERT')
 or has_function_privilege('authenticated',
   'public.register_business_customer(uuid,uuid,text,text,text,text)',
   'EXECUTE')
 then raise exception 'Data API customer grant boundary is unsafe';end if;
end;
$no_direct_business_insert$;

-- Pilot creation before its business backfill (existing production pathway).
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89c00000-0000-4000-8000-000000000001',true);
insert into public.customers(id,name,phone) values
 ('89c00000-0000-4000-9000-000000000011','Pilot before backfill','08012340011');
reset role;

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;n int:=0;
begin
 for r in
 select ns.nspname s,c.relname t,k.conname
 from pg_constraint k join pg_class c on c.oid=k.conrelid
 join pg_namespace ns on ns.oid=c.relnamespace
 join private.legacy_scope_tables() tab
  on tab.schema_name=ns.nspname and tab.table_name=c.relname
 where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute pg_catalog.format('alter table %I.%I validate constraint %I',
    r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Tenant constraint prerequisite drift: %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

-- Preserve post-backfill legacy inserts and edits without business_id.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89c00000-0000-4000-8000-000000000001',true);
insert into public.customers(id,name,phone) values
 ('89c00000-0000-4000-9000-000000000012','Pilot after backfill','08012340012');
update public.customers set name='Pilot edited after backfill'
 where id='89c00000-0000-4000-9000-000000000012';
do $original_shop_unbroken$
begin
 -- Inspect only owner-visible public rows in the authenticated fixture.
 -- Do not grant ordinary owners SELECT on private.businesses.
 if (select count(*) from public.customers)<>2
   or (select count(distinct business_id) from public.customers)<>1
   or exists(select 1 from public.customers where business_id is null)
   or (select name from public.customers
       where id='89c00000-0000-4000-9000-000000000012')
       <>'Pilot edited after backfill' then
   raise exception 'Original shop customer create/edit broke';
 end if;
end;
$original_shop_unbroken$;
reset role;

-- Other owners have separate business memberships, but direct INSERT
-- business_id is unavailable even while an approved setup RPC is used.
insert into private.businesses(id,status) values
 ('89c00000-0000-4000-9000-000000000021','setup'),
 ('89c00000-0000-4000-9000-000000000022','setup');
insert into private.business_memberships(
 business_id,user_id,status,member_kind) values
 ('89c00000-0000-4000-9000-000000000021',
 '89c00000-0000-4000-8000-000000000002','active','owner'),
 ('89c00000-0000-4000-9000-000000000022',
 '89c00000-0000-4000-8000-000000000003','active','owner');

update private.business_selection_gate set enabled=true where singleton;
update private.business_customer_registration_gate set enabled=true where singleton;
grant execute on function public.register_business_customer(
 uuid,uuid,text,text,text,text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89c00000-0000-4000-8000-000000000003',true);
do $second_depot_customer$
declare v jsonb;
begin
 v:=public.register_business_customer(
 '89c00000-0000-4000-9000-000000000022',
 '89c00000-0000-4000-9000-000000000031',
 'Second owner customer','08012340031',null,null);
 if v->>'businessId'<>'89c00000-0000-4000-9000-000000000022'
   or v->>'canOperate'<>'false' then
   raise exception 'Second depot RPC not available after test-only gate';
 end if;
end;
$second_depot_customer$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89c00000-0000-4000-8000-000000000002',true);
do $direct_data_api_attacks$
declare v_sqlstate text;
begin
 -- The same 42501 result for a KNOWN foreign ID and a fresh UUID;
 -- the globally unique customers primary key is never reached.
 begin
   insert into public.customers(
     id,name,phone,business_id) values(
     '89c00000-0000-4000-9000-000000000011',
     'Cross-shop probe','08012340041',
     '89c00000-0000-4000-9000-000000000021');
   raise exception 'Known cross-tenant customer ID was accepted'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   insert into public.customers(
     id,name,phone,business_id) values(
     '89c00000-0000-4000-9000-000000000044',
     'Fresh-ID probe','08012340044',
     '89c00000-0000-4000-9000-000000000021');
   raise exception 'Fresh customer ID passed direct Data API'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 -- Without business_id, a nonlegacy owner cannot use the old legacy
 -- trigger to write unassigned or original-shop customer records.
 begin
   insert into public.customers(id,name,phone) values
     ('89c00000-0000-4000-9000-000000000045',
      'Unscoped new-depot customer','08012340045');
   raise exception 'New depot wrote customer without business identity'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.customers) then
  raise exception 'A owner can read B or pilot customer';
 end if;
end;
$direct_data_api_attacks$;

-- An approved gated tenant RPC can still create new customers without
-- accepting caller-owned global IDs.
do $safe_registration$
declare v jsonb;
begin
 v:=public.register_business_customer(
 '89c00000-0000-4000-9000-000000000021',
 '89c00000-0000-4000-9000-000000000032',
 'First owner customer','08012340032',null,null);
 if v->>'businessId'<>'89c00000-0000-4000-9000-000000000021'
   or (select count(*) from public.customers)<>1 then
  raise exception 'Secure new-depot customer registration broke';
 end if;
end;
$safe_registration$;
reset role;

do $audit_integrity$
begin
 if (select count(*) from public.customers)<>4
 or (select count(*) from private.business_customer_registration_requests)<>2
 then
  raise exception 'Customer Data API denial or guarded RPC altered other shop rows';
 end if;
end;
$audit_integrity$;
rollback;
