-- M2f-46: verify the staged customer RPC and old-app compatibility.
-- Until the new application is deployed, original-shop customer creation
-- continues using direct INSERT(id,name,phone,...). Removing those grants
-- here would cause a database-first rollout outage. A separate admin-gated
-- POST-CUTOVER migration revokes EVERY direct authenticated INSERT column.
-- New-business INSERT(business_id) stays revoked and its RPC stays disabled.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $verify_staged_creation$
begin
 if not has_column_privilege('authenticated','public.customers','id','INSERT')
   or not has_column_privilege('authenticated','public.customers','name','INSERT')
   or has_column_privilege('authenticated','public.customers','business_id','INSERT')
   or has_any_column_privilege('anon','public.customers','INSERT')
 then
   raise exception 'Legacy direct customer INSERT missing or tenant bypass exposed before cutover';
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
   raise exception 'Pre-cutover customer creation RPC permissions drifted';
 end if;
end;
$verify_staged_creation$;
commit;
