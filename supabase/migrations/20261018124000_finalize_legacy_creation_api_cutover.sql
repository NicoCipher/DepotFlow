-- M2f-48: POST-APP-CUTOVER only. NEVER apply during database-first
-- staging while the old Walnik app is serving direct customer/product inserts
-- and create_crate_type RPC calls.
-- This migration MUST fail closed until an operator has verified the new
-- application uses create_legacy_customer/create_legacy_crate_type/
-- create_legacy_product, confirmed hosted login, and explicitly authorized
-- the one-way creation API cutover. It does not enable multi-business.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $cutover_preflight$
begin
 -- A persisted operator approval is NOT enough. A failed attempt might
 -- roll back before clearing that flag, and later app rollback could restore
 -- the old client. Require fresh consent from THIS migration connection.
 -- The operator must run BEGIN; SET LOCAL ...; then this SQL file inside
 -- that same transaction. Generic migration runners never set this flag.
 -- SET LOCAL expires on COMMIT or ROLLBACK, including lock-timeout failures.
 if pg_catalog.current_setting(
      'depotflow.legacy_creation_cutover_attempt',true
    ) is distinct from 'confirmed' then
   raise exception
     'LEGACY CREATION CUTOVER ATTEMPT NOT CONFIRMED: use fresh transaction-scoped operator approval'
     using errcode='42501';
 end if;
 -- Serialize the approved cutover against an operator withdrawing
 -- consent. FOR UPDATE holds the exact gate row lock through COMMIT/ROLLBACK.
 -- If withdrawal wins first, this rechecks the NEW row state after waiting
 -- and fails closed. If cutover locks first, withdrawal must wait for the
 -- completed atomic privilege change instead of racing it.
 perform 1 from private.legacy_creation_cutover_gate
  where singleton is true and authorized is true
    and authorized_at is not null
  for update;
 if not found then
   raise exception
    'LEGACY CREATION CUTOVER NOT AUTHORIZED: keep old-app customer, crate and product creation working'
    using errcode='42501';
 end if;
 -- New-business writes must remain disabled while original-shop creation
 -- privileges are being changed. This is NOT an activation migration.
 if exists(select 1 from private.business_customer_registration_gate
             where enabled is true)
    or exists(select 1 from private.business_selection_gate
             where enabled is true) then
   raise exception 'Cannot cut over original-shop creation with new-business setup enabled'
     using errcode='42501';
 end if;
 if not has_function_privilege('authenticated',
     'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
    or not has_function_privilege('authenticated',
     'public.create_legacy_crate_type(uuid,text,text,integer,text)','EXECUTE')
    or not has_function_privilege('authenticated',
     'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE') then
   raise exception 'Required replacement original-shop create RPC missing'
     using errcode='42501';
 end if;
end;
$cutover_preflight$;

-- Direct customer INSERT (with or without ID) is now removed. Revoking
-- table-level and EVERY column grant avoids a default UUID bypass.
revoke insert on public.customers from authenticated;
do $close_customer_insert$
declare v text;
begin
 for v in select a.attname from pg_catalog.pg_attribute a
   where a.attrelid='public.customers'::regclass
     and a.attnum>0 and not a.attisdropped loop
   execute pg_catalog.format(
     'revoke insert (%I) on public.customers from authenticated',v);
 end loop;
end;
$close_customer_insert$;

-- Remove the old caller-selected crate UUID entrypoints. Editing, pricing
-- and the other existing crate-management wrappers retain their grants.
revoke execute on function public.create_crate_type(uuid,text,text,numeric,text)
 from public,anon,authenticated,service_role;
revoke execute on function private.create_crate_type(uuid,text,text,numeric,text)
 from public,anon,authenticated,service_role;

-- The original direct product INSERT exposes caller-chosen global UUIDs,
-- and leaving a subset of columns would permit DEFAULT UUID bypass.
revoke insert on public.products from authenticated;
do $close_product_insert$
declare v text;
begin
 for v in select a.attname from pg_catalog.pg_attribute a
   where a.attrelid='public.products'::regclass
     and a.attnum>0 and not a.attisdropped loop
   execute pg_catalog.format(
     'revoke insert (%I) on public.products from authenticated',v);
 end loop;
end;
$close_product_insert$;

do $post_cutover_assert$
begin
 if has_any_column_privilege('authenticated','public.customers','INSERT')
 or has_any_column_privilege('authenticated','public.products','INSERT')
 or has_function_privilege('authenticated',
      'public.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
 or has_function_privilege('authenticated',
      'private.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
 or has_function_privilege('anon',
      'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
 or has_function_privilege('anon',
      'public.create_legacy_crate_type(uuid,text,text,integer,text)','EXECUTE')
 or has_function_privilege('anon',
      'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE')
 or not has_function_privilege('authenticated',
      'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
 or not has_function_privilege('authenticated',
      'public.create_legacy_crate_type(uuid,text,text,integer,text)','EXECUTE')
 or not has_function_privilege('authenticated',
      'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE')
 or not has_column_privilege('authenticated','public.customers','name','UPDATE')
 or not has_column_privilege('authenticated','public.products','name','UPDATE') then
   raise exception 'POST-CUTOVER creation privileges are unsafe'
     using errcode='42501';
 end if;
end;
$post_cutover_assert$;

-- Consume the durable signoff on success in the SAME transaction as the
-- privilege revocations. Failed attempts roll back all DDL; the persisted
-- approval may then still be TRUE, but a new connection cannot reuse the
-- expired transaction-scoped approval and must obtain fresh operator consent.
do $consume_cutover_approval$
declare v_affected integer;
begin
 update private.legacy_creation_cutover_gate
   set authorized=false,authorized_at=null
   where singleton is true and authorized is true and authorized_at is not null;
 get diagnostics v_affected = row_count;
 if v_affected <> 1 then
   raise exception 'Approval was not exclusively held through cutover'
     using errcode='42501';
 end if;
end;
$consume_cutover_approval$;
commit;
