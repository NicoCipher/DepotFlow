-- Disposable integration regression: once the legacy gate is activated,
-- revoked membership must block even an idempotent "no change" RPC call.
-- This catches a SECURITY DEFINER product-state/existence oracle.
begin;
insert into auth.users(id) values
  ('89400000-0000-4000-8000-000000000001'),
  ('89400000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('89400000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

insert into public.crate_types(id,name,empty_family,pocket_count)
values ('89400000-0000-4000-9000-000000000010',
        'Lifecycle crate','NB',12);
insert into public.products(
  id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id
) values (
  '89400000-0000-4000-9000-000000000020',
  'Lifecycle drink',12,12000,false,
  '89400000-0000-4000-9000-000000000010'
);

do $source$
begin
 if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
   'public.set_shop_drink_active(uuid,boolean,boolean)'::regprocedure
 ),'private.verified_legacy_owner_read()')=0 then
   raise exception 'Lifecycle RPC lacks active-owner guard';
 end if;
end;
$source$;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89400000-0000-4000-8000-000000000001',true);
do $before_gate$
begin
 if public.set_shop_drink_active(
   '89400000-0000-4000-9000-000000000020',true,true
 ) is distinct from true then
   raise exception 'Preativation owner idempotent call changed';
 end if;
end;
$before_gate$;
reset role;

-- Administrator-only release sequence. This entire test rolls back.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record; v_count int:=0;
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
 if v_count<>31 then
   raise exception 'Incomplete tenant relationship validation: %',v_count;
 end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89400000-0000-4000-8000-000000000001',true);
do $active_owner$
begin
 if public.set_shop_drink_active(
  '89400000-0000-4000-9000-000000000020',false,true
 ) is distinct from false then
   raise exception 'Activated owner cannot remove its own drink';
 end if;
 if public.set_shop_drink_active(
  '89400000-0000-4000-9000-000000000020',false,true
 ) is distinct from false then
   raise exception 'Idempotent lifecycle retry broke';
 end if;
end;
$active_owner$;
reset role;

update private.business_memberships set status='disabled'
where user_id='89400000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89400000-0000-4000-8000-000000000001',true);
do $deny_revoked$
declare v_id uuid;
begin
 foreach v_id in array ARRAY[
   '89400000-0000-4000-9000-000000000020'::uuid,
   '89400000-0000-4000-9000-000000000099'::uuid
 ] loop
   begin
     perform public.set_shop_drink_active(v_id,false,false);
     raise exception 'Revoked owner learned product state or existence'
       using errcode='PT001';
   exception when insufficient_privilege then null;
   end;
 end loop;
end;
$deny_revoked$;

-- A second signed-in user must not be able to enumerate either.
select set_config('request.jwt.claim.sub',
 '89400000-0000-4000-8000-000000000002',true);
do $deny_other$
begin
 begin
   perform public.set_shop_drink_active(
     '89400000-0000-4000-9000-000000000020',false,true
   );
   raise exception 'Other authenticated user queried old shop lifecycle'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$deny_other$;
reset role;

update private.business_memberships set status='active'
where user_id='89400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89400000-0000-4000-8000-000000000001',true);
do $restored_owner$
begin
 if public.set_shop_drink_active(
   '89400000-0000-4000-9000-000000000020',true,false
 ) is distinct from true then
   raise exception 'Reactivated owner cannot restore legitimate drink';
 end if;
end;
$restored_owner$;
reset role;
do $records$
begin
 if (select count(*) from public.products
   where id='89400000-0000-4000-9000-000000000020' and is_active)<>1 then
   raise exception 'Revocation/restore changed product identity or state';
 end if;
end;
$records$;
rollback;
