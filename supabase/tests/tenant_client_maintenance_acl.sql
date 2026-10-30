-- Client maintenance ACL regression. Runs in disposable PostgreSQL 17 only.
begin;

do $client_maintenance_acl$
declare
  v_table text;
  v_role text;
begin
  foreach v_table in array array[
    'public.sale_empty_decisions',
    'public.shop_profile'
  ] loop
    if not (select relrowsecurity from pg_class where oid=v_table::regclass) then
      raise exception 'RLS unexpectedly disabled on %',v_table;
    end if;
    foreach v_role in array array['anon','authenticated'] loop
      if has_table_privilege(v_role,v_table,'TRUNCATE')
         or has_table_privilege(v_role,v_table,'REFERENCES')
         or has_table_privilege(v_role,v_table,'TRIGGER')
         or has_table_privilege(v_role,v_table,'MAINTAIN') then
        raise exception 'Client role % retains non-DML maintenance privilege on %',v_role,v_table;
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon','public.sale_empty_decisions','SELECT')
     or has_table_privilege('anon','public.shop_profile','SELECT')
     or not has_table_privilege('authenticated','public.sale_empty_decisions','SELECT')
     or not has_table_privilege('authenticated','public.shop_profile','SELECT') then
    raise exception 'Expected authenticated-only SELECT access changed';
  end if;

  if has_table_privilege('authenticated','public.sale_empty_decisions','INSERT')
     or has_table_privilege('authenticated','public.sale_empty_decisions','UPDATE')
     or has_table_privilege('authenticated','public.sale_empty_decisions','DELETE')
     or has_table_privilege('authenticated','public.shop_profile','INSERT')
     or has_table_privilege('authenticated','public.shop_profile','UPDATE')
     or has_table_privilege('authenticated','public.shop_profile','DELETE') then
    raise exception 'Unexpected authenticated DML grant detected';
  end if;

end;
$client_maintenance_acl$;

rollback;
