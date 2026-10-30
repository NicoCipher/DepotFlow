-- Restore the exact pre-hardening production client ACL on a disposable
-- PostgreSQL 17 reconstruction immediately before the forward migration.
-- Never execute this fixture against hosted production.
grant truncate, references, trigger, maintain on table
  public.sale_empty_decisions,
  public.shop_profile
to anon, authenticated;

do $legacy_acl_snapshot$
begin
  if not has_table_privilege('anon','public.sale_empty_decisions','TRUNCATE')
     or not has_table_privilege('authenticated','public.sale_empty_decisions','TRUNCATE')
     or not has_table_privilege('anon','public.shop_profile','TRUNCATE')
     or not has_table_privilege('authenticated','public.shop_profile','TRUNCATE') then
    raise exception 'Disposable pre-hardening client ACL snapshot failed';
  end if;
end;
$legacy_acl_snapshot$;
