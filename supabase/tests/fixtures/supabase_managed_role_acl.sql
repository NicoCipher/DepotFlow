-- Reproduce the exact Supabase-managed service_role relation ACLs found in
-- the read-only 2026-10-29 production fingerprint. This is disposable CI only;
-- never run this fixture against production. Supabase grants these maintenance
-- privileges without granting service_role table SELECT/INSERT/UPDATE/DELETE.
grant truncate, references, trigger, maintain on table
  public.bottle_deposit_price,
  public.bottle_obligations,
  public.crate_deposit_prices,
  public.crate_obligations,
  public.crate_swap_rules,
  public.crate_types,
  public.customer_opening_balances,
  public.customer_payments,
  public.customers,
  public.deposits,
  public.empty_bottle_stock,
  public.empty_crate_movements,
  public.empty_crate_stock,
  public.known_empty_crates,
  public.money_owed,
  public.product_catalogue,
  public.product_cost_history,
  public.product_selling_price_history,
  public.products,
  public.sale_empty_bottle_returns,
  public.sale_empty_crate_returns,
  public.sale_empty_decisions,
  public.sale_items,
  public.sale_tender_legs,
  public.sales,
  public.shop_profile,
  public.stock,
  public.stock_movements
to service_role;

do $managed_acl_check$
declare
  v_relation text;
begin
  foreach v_relation in array array[
    'public.bottle_deposit_price',
    'public.bottle_obligations',
    'public.crate_deposit_prices',
    'public.crate_obligations',
    'public.crate_swap_rules',
    'public.crate_types',
    'public.customer_opening_balances',
    'public.customer_payments',
    'public.customers',
    'public.deposits',
    'public.empty_bottle_stock',
    'public.empty_crate_movements',
    'public.empty_crate_stock',
    'public.known_empty_crates',
    'public.money_owed',
    'public.product_catalogue',
    'public.product_cost_history',
    'public.product_selling_price_history',
    'public.products',
    'public.sale_empty_bottle_returns',
    'public.sale_empty_crate_returns',
    'public.sale_empty_decisions',
    'public.sale_items',
    'public.sale_tender_legs',
    'public.sales',
    'public.shop_profile',
    'public.stock',
    'public.stock_movements'
  ] loop
    if not has_table_privilege('service_role',v_relation,'REFERENCES')
      or not has_table_privilege('service_role',v_relation,'TRIGGER') then
      raise exception 'Managed service_role ACL mismatch on %',v_relation;
    end if;
  end loop;

  if has_table_privilege('service_role','public.business_profiles','REFERENCES')
    or has_table_privilege('service_role','public.business_profiles','TRIGGER') then
    raise exception 'Unexpected managed service_role ACL on public.business_profiles';
  end if;

  if has_table_privilege('service_role','public.products','SELECT')
    or has_table_privilege('service_role','public.products','INSERT')
    or has_table_privilege('service_role','public.products','UPDATE')
    or has_table_privilege('service_role','public.products','DELETE') then
    raise exception 'Managed ACL fixture accidentally granted service_role DML';
  end if;
end;
$managed_acl_check$;
