-- M2f-46: all browser customer creation must use a verified, audited RPC.
-- M2f-44/45 removed the two caller-chosen PK grants, but the original
-- authenticated INSERT(name,phone,...) columns could still bypass immutable
-- request replay by omitting id (customers.id defaults to gen_random_uuid()).
-- Both guided onboarding and legacy checkout now call server-generated-ID
-- security-definer RPCs. Keep the original shop's UPDATE/SELECT permissions.
-- No new business activation, service grants or changes to existing rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

revoke insert (name,phone,business_name,address)
 on public.customers from authenticated;

do $enforce_rpc_creation$
begin
 if has_any_column_privilege(
   'authenticated','public.customers','INSERT')
   or has_any_column_privilege('anon','public.customers','INSERT')
 then
   raise exception 'Direct Data API customer INSERT still available';
 end if;
 if not has_column_privilege('authenticated','public.customers',
    'name','UPDATE')
    or not has_column_privilege('authenticated','public.customers',
    'phone','UPDATE')
    or not has_column_privilege('authenticated','public.customers',
    'name','SELECT')
 then
   raise exception 'Legacy customer editing or reading lost permissions';
 end if;
 if not has_function_privilege('authenticated',
   'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
   or has_function_privilege('anon',
   'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
   or has_function_privilege('authenticated',
   'public.register_business_customer(uuid,uuid,text,text,text,text)','EXECUTE')
 then
   raise exception 'Customer creation RPC permissions drifted';
 end if;
end;
$enforce_rpc_creation$;
commit;
