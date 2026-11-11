-- Regression guard for request-scoped append-only buying-cost history.
-- This is a schema/function contract test; the full write-path is exercised by
-- the database verification workflow against disposable PostgreSQL 17.
begin;

do $cost_reversion_contract$
declare
  v_definition text;
  v_index_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='product_cost_history'
      and column_name='source_request_id' and is_nullable='YES'
  ) then
    raise exception 'Cost history must carry an optional source request ID for legacy rows';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.update_legacy_product_prices(uuid,jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null
     or pg_catalog.strpos(v_definition,'source_request_id')=0
     or pg_catalog.strpos(v_definition,'p_request_id')=0
     or pg_catalog.strpos(v_definition,'on conflict do nothing')>0
     or pg_catalog.strpos(v_definition,'order by h.effective_on desc,h.recorded_at desc,h.id desc')=0 then
    raise exception 'Cost update must append request-scoped events and order current cost by event order';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid=i.indexrelid
    join pg_catalog.pg_namespace n on n.oid=idx.relnamespace
    where n.nspname='public' and idx.relname='product_cost_history_business_request_uidx'
      and i.indisunique
      and pg_catalog.pg_get_expr(i.indpred,i.indrelid)=
          '(business_id IS NOT NULL) AND (source_request_id IS NOT NULL)'
  ) then
    raise exception 'Business-scoped request uniqueness must be enforced';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid=i.indexrelid
    join pg_catalog.pg_namespace n on n.oid=idx.relnamespace
    where n.nspname='public' and idx.relname='product_cost_history_legacy_request_uidx'
      and i.indisunique
      and pg_catalog.pg_get_expr(i.indpred,i.indrelid)=
          '(business_id IS NULL) AND (source_request_id IS NOT NULL)'
  ) then
    raise exception 'Legacy NULL-business request uniqueness must be enforced';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class idx
    join pg_catalog.pg_namespace n on n.oid=idx.relnamespace
    where n.nspname='public'
      and idx.relname in ('business_cost_history_unique','prebackfill_owner_cost_history_unique')
  ) then
    raise exception 'Old cost-value uniqueness indexes must be removed';
  end if;
end;
$cost_reversion_contract$;

rollback;
