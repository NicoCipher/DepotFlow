-- Disposable PostgreSQL 16 test: six SECURITY DEFINER reports must honor
-- revoked legacy membership despite bypassing ordinary table RLS.
-- Public verification-by-token intentionally stays accessible to anon.
begin;
insert into auth.users(id) values
 ('89100000-0000-4000-8000-000000000001'),
 ('89100000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('89100000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.customers(id,name,phone)
values ('89100000-0000-4000-9000-000000000011',
        'Privileged report fixture','08001110011');
insert into public.sales(id,customer_id,total_amount,paid_amount,business_date)
values ('89100000-0000-4000-9000-000000000012',
        '89100000-0000-4000-9000-000000000011',
        900,500,'2026-10-15');

create function pg_temp.check_ok(v boolean,message text)
returns void language plpgsql as $$
begin if v is distinct from true then raise exception '%',message; end if;end;$$;

-- Confirm all six definer bodies have BOTH the old singleton check and the
-- new active-membership check, and public verify_receipt was not altered.
do $source_audit$
declare v_count integer;
begin
 select count(*) into v_count
 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public'
 and p.proname in (
  'customer_account_snapshot','customer_recent_activity',
  'customer_records','customer_return_record',
  'manager_snapshot','store_activity'
 )
 and p.prosecdef
 and position('if not private.verified_legacy_owner_read() or not exists'
   in pg_get_functiondef(p.oid))>0;
 if v_count<>6 then raise exception 'Expected all six guarded reporting RPCs; got %',v_count; end if;
 if not has_function_privilege('anon','public.verify_receipt(uuid)','EXECUTE')
    or position('verified_legacy_owner_read'
        in pg_get_functiondef('public.verify_receipt(uuid)'::regprocedure))<>0 then
   raise exception 'Public receipt verification was restricted';
 end if;
end;
$source_audit$;

-- Reused unchanged across the original owner, disabled owner and new user.
create temp table report_calls(name text primary key,rpc_sql text not null);
insert into report_calls(name,rpc_sql) values
('customer_account_snapshot',
 'select * from public.customer_account_snapshot(array[''89100000-0000-4000-9000-000000000011''::uuid])'),
('customer_recent_activity',
 'select * from public.customer_recent_activity(''89100000-0000-4000-9000-000000000011''::uuid)'),
('customer_records',
 'select * from public.customer_records(''2026-10-15''::date,''2026-10-15''::date,''all'',''all'','''',10,null,false)'),
('customer_return_record',
 'select * from public.customer_return_record(''89100000-0000-4000-9000-000000000013''::uuid)'),
('manager_snapshot',
 'select * from public.manager_snapshot(''2026-10-15''::date)'),
('store_activity',
 'select * from public.store_activity(''2026-10-15''::date,''2026-10-15''::date,null,''all'',20,0)');
-- pg_temp data was created by the test admin role. The mocked PostgREST
-- authenticated role needs READ on these test-only call definitions.
grant select on pg_temp.report_calls to authenticated;

-- Preactivation legacy reads stay compatible.
set local role authenticated;
select set_config('request.jwt.claim.sub','89100000-0000-4000-8000-000000000001',true);
do $legacy_owner$
declare r record;v_count integer;
begin
 for r in select * from pg_temp.report_calls order by name loop
   execute 'select count(*) from ('||r.rpc_sql||') x' into v_count;
   if v_count is null then
     raise exception 'Legacy owner report was blocked: %',r.name;
   end if;
 end loop;
end;
$legacy_owner$;
reset role;

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;v_count integer:=0;
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
 if v_count<>31 then raise exception 'M2c relationships are incomplete: %',v_count; end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

-- Verified active owner still sees exactly the same data after activation.
set local role authenticated;
select set_config('request.jwt.claim.sub','89100000-0000-4000-8000-000000000001',true);
do $active_owner$
declare r record;v_count integer;
begin
 for r in select * from pg_temp.report_calls order by name loop
   execute 'select count(*) from ('||r.rpc_sql||') x' into v_count;
   if v_count is null then
     raise exception 'Active owner reporting failed: %',r.name;
   end if;
 end loop;
end;
$active_owner$;
reset role;

-- Revocation is a permission change only, not data deletion.
update private.business_memberships set status='disabled'
where user_id='89100000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','89100000-0000-4000-8000-000000000001',true);
do $revoked$
declare r record;v_count integer;
begin
 for r in select * from pg_temp.report_calls order by name loop
   begin
     execute 'select count(*) from ('||r.rpc_sql||') x' into v_count;
     raise exception 'Revoked owner could read privileged report: %',r.name
       using errcode='PT001';
   exception when insufficient_privilege then
     null;
   end;
 end loop;
end;
$revoked$;

-- Another authenticated user cannot call any report without being linked.
select set_config('request.jwt.claim.sub','89100000-0000-4000-8000-000000000002',true);
do $outsider$
declare r record;v_count integer;
begin
 for r in select * from pg_temp.report_calls order by name loop
   begin
     execute 'select count(*) from ('||r.rpc_sql||') x' into v_count;
     raise exception 'Second Auth user read privileged report: %',r.name
       using errcode='PT001';
   exception when insufficient_privilege then null;
   end;
 end loop;
end;
$outsider$;
reset role;

-- A validly scoped receipt remains anonymously verifiable after owner revocation.
do $data_check$
begin
 if (select count(*) from public.sales where
   id='89100000-0000-4000-9000-000000000012')<>1
   or (select total_amount from public.sales where
     id='89100000-0000-4000-9000-000000000012')<>900 then
   raise exception 'Revocation mutated the historical sale';
 end if;
end;
$data_check$;

set local role anon;
select pg_temp.check_ok(
 public.verify_receipt('89100000-0000-4000-9000-000000000099') is null,
 'Unknown public verification token should return no receipt');
rollback;
