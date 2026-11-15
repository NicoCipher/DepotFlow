-- Validate the composite tenant foreign keys introduced by the M2 foundation.
-- This is a metadata/integrity hardening migration only: it changes no rows,
-- grants, policies, feature gates, or legacy write settings.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  expected_count integer := 31;
  found_count integer;
  unvalidated_count integer;
begin
  select count(*), count(*) filter (where not convalidated)
    into found_count, unvalidated_count
  from pg_constraint
  where contype = 'f'
    and conname like 'tenant\_%' escape '\'
    and conrelid in (
      'public.bottle_obligations'::regclass,
      'public.crate_obligations'::regclass,
      'public.crate_swap_rules'::regclass,
      'public.customer_opening_balances'::regclass,
      'public.customer_payments'::regclass,
      'public.deposits'::regclass,
      'public.empty_crate_movements'::regclass,
      'public.empty_crate_stock'::regclass,
      'public.money_owed'::regclass,
      'private.customer_empty_returns'::regclass,
      'private.held_empty_collections'::regclass,
      'private.stock_receipts'::regclass,
      'public.products'::regclass,
      'public.sale_empty_bottle_returns'::regclass,
      'public.sale_empty_crate_returns'::regclass,
      'public.sale_empty_decisions'::regclass,
      'public.sale_items'::regclass,
      'public.sales'::regclass,
      'public.stock'::regclass,
      'public.stock_movements'::regclass
    );

  if found_count <> expected_count then
    raise exception 'Expected exactly % tenant foreign keys, found %',
      expected_count, found_count;
  end if;
  if unvalidated_count <> expected_count then
    raise exception 'Expected all % tenant foreign keys to be unvalidated before this migration; found %',
      expected_count, unvalidated_count;
  end if;
end;
$preflight$;

alter table public.bottle_obligations
  validate constraint tenant_bottle_obligations_customer_id_fkey;
alter table public.crate_obligations
  validate constraint tenant_crate_obligations_crate_type_id_fkey;
alter table public.crate_obligations
  validate constraint tenant_crate_obligations_customer_id_fkey;
alter table public.crate_swap_rules
  validate constraint tenant_crate_swap_rules_owed_crate_type_id_fkey;
alter table public.crate_swap_rules
  validate constraint tenant_crate_swap_rules_returned_crate_type_id_fkey;
alter table public.customer_opening_balances
  validate constraint tenant_customer_opening_balances_customer_id_fkey;
alter table public.customer_payments
  validate constraint tenant_customer_payments_customer_id_fkey;
alter table public.deposits
  validate constraint tenant_deposits_customer_id_fkey;
alter table public.empty_crate_movements
  validate constraint tenant_empty_crate_movements_crate_type_id_fkey;
alter table public.empty_crate_stock
  validate constraint tenant_empty_crate_stock_crate_type_id_fkey;
alter table public.money_owed
  validate constraint tenant_money_owed_customer_id_fkey;
alter table private.customer_empty_returns
  validate constraint tenant_customer_empty_returns_customer_id_fkey;
alter table private.held_empty_collections
  validate constraint tenant_held_empty_collections_customer_id_fkey;
alter table private.held_empty_collections
  validate constraint tenant_held_empty_collections_decision_id_fkey;
alter table private.stock_receipts
  validate constraint tenant_stock_receipts_crate_type_id_fkey;
alter table private.stock_receipts
  validate constraint tenant_stock_receipts_product_id_fkey;
alter table public.products
  validate constraint tenant_products_crate_type_id_fkey;
alter table public.sale_empty_bottle_returns
  validate constraint tenant_sale_empty_bottle_returns_sale_id_fkey;
alter table public.sale_empty_crate_returns
  validate constraint tenant_sale_empty_crate_returns_crate_type_id_fkey;
alter table public.sale_empty_crate_returns
  validate constraint tenant_sale_empty_crate_returns_sale_id_fkey;
alter table public.sale_empty_decisions
  validate constraint tenant_sale_empty_decisions_customer_id_fkey;
alter table public.sale_empty_decisions
  validate constraint tenant_sale_empty_decisions_product_id_fkey;
alter table public.sale_empty_decisions
  validate constraint tenant_sale_empty_decisions_sale_id_fkey;
alter table public.sale_items
  validate constraint tenant_sale_items_crate_type_id_fkey;
alter table public.sale_items
  validate constraint tenant_sale_items_product_id_fkey;
alter table public.sale_items
  validate constraint tenant_sale_items_sale_id_fkey;
alter table public.sales
  validate constraint tenant_sales_customer_id_fkey;
alter table public.stock
  validate constraint tenant_stock_product_id_fkey;
alter table public.stock_movements
  validate constraint tenant_stock_movements_crate_type_id_fkey;
alter table public.stock_movements
  validate constraint tenant_stock_movements_product_id_fkey;
alter table public.stock_movements
  validate constraint tenant_stock_movements_sale_id_fkey;

commit;
