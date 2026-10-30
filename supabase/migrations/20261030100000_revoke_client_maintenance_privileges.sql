-- Remove non-DML maintenance grants accidentally exposed to client API roles.
-- TRUNCATE bypasses RLS. Preserve authenticated reads and Supabase-managed
-- service_role ACLs; scope this repair to the two affected public tables.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if not (select relrowsecurity from pg_class where oid='public.sale_empty_decisions'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.shop_profile'::regclass) then
    raise exception 'Expected RLS on protected tables; refusing ACL hardening';
  end if;
  if has_table_privilege('anon','public.sale_empty_decisions','SELECT')
     or has_table_privilege('anon','public.shop_profile','SELECT')
     or not has_table_privilege('authenticated','public.sale_empty_decisions','SELECT')
     or not has_table_privilege('authenticated','public.shop_profile','SELECT') then
    raise exception 'Unexpected client SELECT baseline; refusing ACL hardening';
  end if;
end;
$preflight$;

revoke truncate, references, trigger, maintain
  on table public.sale_empty_decisions, public.shop_profile
  from anon, authenticated;

do $postflight$
declare
  v_table text;
  v_role text;
begin
  foreach v_table in array array[
    'public.sale_empty_decisions',
    'public.shop_profile'
  ] loop
    foreach v_role in array array['anon','authenticated'] loop
      if has_table_privilege(v_role,v_table,'TRUNCATE')
         or has_table_privilege(v_role,v_table,'REFERENCES')
         or has_table_privilege(v_role,v_table,'TRIGGER')
         or has_table_privilege(v_role,v_table,'MAINTAIN') then
        raise exception 'Client maintenance grant remains: % on %',v_role,v_table;
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon','public.sale_empty_decisions','SELECT')
     or has_table_privilege('anon','public.shop_profile','SELECT')
     or not has_table_privilege('authenticated','public.sale_empty_decisions','SELECT')
     or not has_table_privilege('authenticated','public.shop_profile','SELECT') then
    raise exception 'Client SELECT access changed during ACL hardening';
  end if;

  -- These four grants are Supabase-managed on these relations. The migration
  -- must not revoke them while removing the client-role grants.
  if not has_table_privilege('service_role','public.sale_empty_decisions','TRUNCATE')
     or not has_table_privilege('service_role','public.sale_empty_decisions','REFERENCES')
     or not has_table_privilege('service_role','public.sale_empty_decisions','TRIGGER')
     or not has_table_privilege('service_role','public.sale_empty_decisions','MAINTAIN')
     or not has_table_privilege('service_role','public.shop_profile','TRUNCATE')
     or not has_table_privilege('service_role','public.shop_profile','REFERENCES')
     or not has_table_privilege('service_role','public.shop_profile','TRIGGER')
     or not has_table_privilege('service_role','public.shop_profile','MAINTAIN') then
    raise exception 'Supabase-managed service_role maintenance grants changed';
  end if;
end;
$postflight$;
commit;
