-- Rollback-only: NEW business customer identity generated on the server,
-- no caller-supplied global PK and tenant-local immutable request retries.
begin;
insert into auth.users(id) values
 ('89d00000-0000-4000-8000-000000000001'),
 ('89d00000-0000-4000-8000-000000000002'),
 ('89d00000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values('89d00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $fk_check$
declare x record;n int:=0;
begin
 for x in select ns.nspname s,c.relname t,k.conname
  from pg_constraint k join pg_class c on c.oid=k.conrelid
  join pg_namespace ns on ns.oid=c.relnamespace
  join private.legacy_scope_tables() tab
  on tab.schema_name=ns.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute pg_catalog.format('alter table %I.%I validate constraint %I',
    x.s,x.t,x.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Tenant FK drift: %',n; end if;
end;
$fk_check$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89d00000-0000-4000-9000-000000000021','setup'),
 ('89d00000-0000-4000-9000-000000000022','setup');
insert into private.business_memberships(business_id,user_id,member_kind,status)
 values
 ('89d00000-0000-4000-9000-000000000021',
  '89d00000-0000-4000-8000-000000000002','owner','active'),
 ('89d00000-0000-4000-9000-000000000022',
  '89d00000-0000-4000-8000-000000000003','owner','active');

do $safe_defaults$
begin
 if (select enabled from private.business_customer_registration_gate)
   or has_function_privilege('authenticated',
    'public.register_business_customer(uuid,uuid,text,text,text,text)','EXECUTE')
   or has_function_privilege('anon',
    'public.register_business_customer(uuid,uuid,text,text,text,text)','EXECUTE')
   or has_table_privilege('authenticated',
    'private.business_customer_registration_requests','SELECT, INSERT, UPDATE, DELETE')
 then
   raise exception 'Tenant customer creation has unreviewed permission';
 end if;
end;
$safe_defaults$;

grant execute on function public.register_business_customer(
 uuid,uuid,text,text,text,text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000002',true);
do $gate_off$
begin
 begin
  perform public.register_business_customer(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000031',
   'A customer','08012340021',null,null);
  raise exception 'Customer registration ignored disabled gate'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$gate_off$;
reset role;
update private.business_customer_registration_gate set enabled=true;
update private.business_selection_gate set enabled=true;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000002',true);
do $a_register$
declare v jsonb;r jsonb;v_id uuid;
begin
 v:=public.register_business_customer(
  '89d00000-0000-4000-9000-000000000021',
  '89d00000-0000-4000-9000-000000000031',
  ' A   customer ', '+2348012340021',
  'A Hotel','Lagos');
 v_id:=(v->>'customerId')::uuid;
 if v->>'businessId'<>'89d00000-0000-4000-9000-000000000021'
  or v->>'savedReplay'<>'false'
  or v->>'canOperate'<>'false' then
  raise exception 'A registration result invalid: %',v;
 end if;
 r:=public.register_business_customer(
  '89d00000-0000-4000-9000-000000000021',
  '89d00000-0000-4000-9000-000000000031',
  'A customer', '+2348012340021',
  'A Hotel','Lagos');
 if r->>'customerId'<>v_id::text or r->>'savedReplay'<>'true'
  then raise exception 'A idempotent replay generated a second identity: %',r;
 end if;
 if (select count(*) from public.customers)<>1
  or (select name from public.customers limit 1)<>'A customer'
  then raise exception 'A customer insert not scoped to A';
 end if;
 begin
  perform public.register_business_customer(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000031',
   'Different customer', '+2348012340021',null,null);
  raise exception 'Changed request overwrote existing customer'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.register_business_customer(
   '89d00000-0000-4000-9000-000000000022',
   '89d00000-0000-4000-9000-000000000031',
   'Foreign customer', '+2348012340021',null,null);
  raise exception 'A wrote B customer' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$a_register$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000003',true);
do $b_register$
declare v jsonb;r jsonb;
begin
 v:=public.register_business_customer(
  '89d00000-0000-4000-9000-000000000022',
  '89d00000-0000-4000-9000-000000000031',
  'B customer','08012340022',null,null);
 r:=public.register_business_customer(
  '89d00000-0000-4000-9000-000000000022',
  '89d00000-0000-4000-9000-000000000031',
  'B customer','08012340022',null,null);
 if v->>'customerId'<>r->>'customerId'
  or v->>'savedReplay'<>'false' or r->>'savedReplay'<>'true'
  or (select count(*) from public.customers)<>1 then
    raise exception 'B request mixed with A or lost idempotency: %, %',v,r;
 end if;
end;
$b_register$;
reset role;

do $two_customer_rows$
begin
 if (select count(*) from private.business_customer_registration_requests)<>2
  or (select count(*) from public.customers)<>2
  or (select count(distinct customer_id)
     from private.business_customer_registration_requests)<>2 then
  raise exception 'Customer request identities are not tenant-isolated';
 end if;
end;
$two_customer_rows$;

update private.business_memberships set status='disabled'
 where business_id='89d00000-0000-4000-9000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000002',true);
do $revoked_replay$
begin
 begin
  perform public.register_business_customer(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000031',
   'A customer', '+2348012340021','A Hotel','Lagos');
  raise exception 'Revoked owner recovered private customer identity'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$revoked_replay$;
reset role;
rollback;
