-- M2a: introduce business identity on every tenant-owned operational table.
-- ADDITIVE ONLY. Do not use these nullable tags for authorization yet.
-- The owner-only legacy RLS and all SQL functions remain unchanged.
-- M2b will backfill *verified* legacy ownership; M2c will validate exact
-- business-aware FKs and change protected writes; M3 will replace owner RLS.
-- The shared public.product_catalogue intentionally stays global.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.bottle_deposit_price
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.bottle_obligations
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.crate_deposit_prices
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.crate_obligations
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.crate_swap_rules
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.crate_types
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.customer_opening_balances
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.customer_payments
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.customers
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.deposits
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.empty_bottle_stock
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.empty_crate_movements
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.empty_crate_stock
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.money_owed
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.product_cost_history
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.product_selling_price_history
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.products
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.sale_empty_bottle_returns
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.sale_empty_crate_returns
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.sale_empty_decisions
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.sale_items
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.sales
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.shop_profile
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.stock
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table public.stock_movements
  add column business_id uuid references private.businesses(id) on delete restrict;

alter table private.confirmed_selling_prices
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table private.customer_empty_returns
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table private.held_empty_collections
  add column business_id uuid references private.businesses(id) on delete restrict;
alter table private.stock_receipts
  add column business_id uuid references private.businesses(id) on delete restrict;

-- Guardrails: no defaults, no automatic mapping from whoever signs in,
-- no new permission grants, no RLS policy widening and no staff activation.
-- At this stage existing owner-only app writes still produce NULL tags.
-- A new depot must NOT become active until future validation ensures every
-- protected row and cross-table reference belongs to exactly that business.
commit;
