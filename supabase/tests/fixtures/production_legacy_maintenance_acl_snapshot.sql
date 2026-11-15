-- Reproduce the exact pre-hardening production ACLs only in the disposable
-- 121-stage parity reconstruction. Never run this fixture against production.
grant truncate, references, trigger, maintain on table
  public.sale_empty_decisions,
  public.shop_profile
to anon, authenticated;

do $legacy_acl_snapshot_check$
begin
  if not has_table_privilege('anon','public.sale_empty_decisions','TRUNCATE')
    or not has_table_privilege('authenticated','public.sale_empty_decisions','TRUNCATE')
    or not has_table_privilege('anon','public.shop_profile','TRUNCATE')
    or not has_table_privilege('authenticated','public.shop_profile','TRUNCATE')
    or has_table_privilege('anon','public.sale_empty_decisions','SELECT')
    or has_table_privilege('anon','public.shop_profile','SELECT')
    or not has_table_privilege('authenticated','public.sale_empty_decisions','SELECT')
    or not has_table_privilege('authenticated','public.shop_profile','SELECT') then
    raise exception 'Disposable legacy ACL snapshot does not match captured production state';
  end if;
end;
$legacy_acl_snapshot_check$;
