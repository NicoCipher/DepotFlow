-- Regression: every composite tenant FK must be validated after the
-- forward-only tenant integrity hardening migration.
begin;
do $test$
declare
  expected_count integer := 31;
  found_count integer;
  unvalidated_count integer;
begin
  select count(*), count(*) filter (where not convalidated)
    into found_count, unvalidated_count
  from pg_constraint
  where contype='f'
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
  if found_count <> expected_count or unvalidated_count <> 0 then
    raise exception 'Tenant FK validation incomplete: found %, still unvalidated %',
      found_count, unvalidated_count;
  end if;
end;
$test$;
rollback;
