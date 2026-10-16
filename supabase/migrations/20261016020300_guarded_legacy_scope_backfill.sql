-- M2b: guarded, admin-invoked tagging of the EXISTING test workspace.
-- This migration installs tooling only. It NEVER backfills operational rows
-- during migration, never enables tenant login, and never widens RLS/grants.
-- Before any real invocation: verify a restorable backup, compare the read-only
-- snapshot, prevent shop writes, run the backfill in an explicit transaction,
-- and reconcile receipts, debt, stock and empties after completion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Existing crate metadata may legitimately contain a historic product/pocket
-- mismatch. The old blanket UPDATE trigger also fired for a business_id-only
-- tag, even though no packaging metadata changed. Keep validation on every
-- pocket_count edit; never disable it during ordinary crate editing.
drop trigger crate_product_pockets on public.crate_types;
create trigger crate_product_pockets
before update of pocket_count on public.crate_types
for each row execute function private.check_crate_product_pockets();

-- Explicit allowlist: product_catalogue is global, never legacy-tagged.
create function private.legacy_scope_tables()
returns table(schema_name text, table_name text)
language sql immutable security invoker set search_path=''
as $$
  select v.schema_name, v.table_name from (values
    ('public','bottle_deposit_price'),
    ('public','bottle_obligations'),
    ('public','crate_deposit_prices'),
    ('public','crate_obligations'),
    ('public','crate_swap_rules'),
    ('public','crate_types'),
    ('public','customer_opening_balances'),
    ('public','customer_payments'),
    ('public','customers'),
    ('public','deposits'),
    ('public','empty_bottle_stock'),
    ('public','empty_crate_movements'),
    ('public','empty_crate_stock'),
    ('public','money_owed'),
    ('public','product_cost_history'),
    ('public','product_selling_price_history'),
    ('public','products'),
    ('public','sale_empty_bottle_returns'),
    ('public','sale_empty_crate_returns'),
    ('public','sale_empty_decisions'),
    ('public','sale_items'),
    ('public','sales'),
    ('public','shop_profile'),
    ('public','stock'),
    ('public','stock_movements'),
    ('private','confirmed_selling_prices'),
    ('private','customer_empty_returns'),
    ('private','held_empty_collections'),
    ('private','stock_receipts')
  ) as v(schema_name,table_name)
  order by v.schema_name, v.table_name;
$$;

-- READ ONLY. Returns a per-table integer inventory without customer details.
-- 'foreign' means an operational row already claims another business.
create function private.legacy_scope_snapshot()
returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_business uuid;
  v_row record;
  v_total bigint;
  v_null bigint;
  v_legacy bigint;
  v_foreign bigint;
  v_result jsonb := '{}'::jsonb;
begin
  select id into v_business from private.businesses
  where legacy_singleton is true and status='active';
  if v_business is null then
    raise exception 'No active linked legacy shop; run the audited M1b link first';
  end if;
  for v_row in select * from private.legacy_scope_tables() loop
    execute pg_catalog.format(
      'select count(*), count(*) filter (where business_id is null),
         count(*) filter (where business_id=$1),
         count(*) filter (where business_id is not null and business_id<>$1)
       from %I.%I',v_row.schema_name,v_row.table_name)
    into v_total,v_null,v_legacy,v_foreign using v_business;
    v_result := v_result || pg_catalog.jsonb_build_object(
      v_row.schema_name||'.'||v_row.table_name,
      pg_catalog.jsonb_build_object(
        'total',v_total,'unassigned',v_null,
        'legacy',v_legacy,'foreign',v_foreign));
  end loop;
  return v_result;
end;
$$;

-- An admin must explicitly pass the inventory snapshot inspected beforehand.
-- Lock all scoped tables before rechecking counts so concurrent writes cannot
-- sneak between snapshot verification and the atomic update. A changed inventory
-- or foreign business tag aborts the WHOLE call; no partial backfill remains.
create function private.backfill_legacy_shop_rows(p_expected_snapshot jsonb)
returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_business uuid;
  v_owner uuid;
  v_row record;
  v_key text;
  v_current jsonb;
  v_after jsonb;
  v_assigned bigint := 0;
  v_updated bigint;
begin
  if p_expected_snapshot is null
     or pg_catalog.jsonb_typeof(p_expected_snapshot) <> 'object' then
    raise exception 'An approved JSON object snapshot is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(81015, 610);
  -- Freeze ownership metadata too: another admin cannot create an owner or
  -- business between the singleton check and our table-wide backfill.
  lock table private.businesses, private.business_memberships,
    private.shop_owner in share row exclusive mode;
  if (select count(*) from private.businesses) <> 1
     or (select count(*) from private.shop_owner) <> 1
     or (select count(*) from private.business_memberships) <> 1 then
    raise exception 'Backfill only supports the single-owner legacy-only stage';
  end if;
  select user_id into v_owner from private.shop_owner;
  select b.id into v_business
  from private.businesses b
  join private.business_memberships m on m.business_id=b.id
  where b.legacy_singleton is true and b.status='active'
    and m.user_id=v_owner and m.member_kind='owner'
    and m.status='active';
  if v_business is null
     or not exists(select 1 from auth.users where id=v_owner) then
    raise exception 'Verified active legacy ownership is required';
  end if;
  if (select count(*) from private.legacy_scope_tables()) <> 29 then
    raise exception 'Scoped table inventory changed; review before backfill';
  end if;

  -- SHARE ROW EXCLUSIVE prevents concurrent app INSERT/UPDATE/DELETE while
  -- allowing read-only reporting. Caller must commit/rollback deliberately.
  for v_row in select * from private.legacy_scope_tables() loop
    execute pg_catalog.format('lock table %I.%I in share row exclusive mode',
      v_row.schema_name,v_row.table_name);
  end loop;
  v_current := private.legacy_scope_snapshot();
  if v_current <> p_expected_snapshot then
    raise exception 'Legacy inventory changed since review; no rows updated';
  end if;
  for v_row in select * from private.legacy_scope_tables() loop
    v_key := v_row.schema_name||'.'||v_row.table_name;
    if (v_current->v_key->>'foreign')::bigint <> 0 then
      raise exception 'Other business is already tagged on %; no rows updated',v_key;
    end if;
  end loop;

  for v_row in select * from private.legacy_scope_tables() loop
    execute pg_catalog.format(
      'update %I.%I set business_id=$1 where business_id is null',
      v_row.schema_name,v_row.table_name) using v_business;
    get diagnostics v_updated = row_count;
    v_assigned := v_assigned + v_updated;
  end loop;
  v_after := private.legacy_scope_snapshot();
  for v_row in select * from private.legacy_scope_tables() loop
    v_key := v_row.schema_name||'.'||v_row.table_name;
    if (v_after->v_key->>'total')::bigint
        <> (v_current->v_key->>'total')::bigint
       or (v_after->v_key->>'unassigned')::bigint <> 0
       or (v_after->v_key->>'foreign')::bigint <> 0
       or (v_after->v_key->>'legacy')::bigint
          <> (v_after->v_key->>'total')::bigint then
      raise exception 'Post-backfill verification failed on %; transaction aborted',v_key;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object(
    'legacy_business_id',v_business,'rows_assigned',v_assigned,
    'after',v_after);
end;
$$;

-- Private administrative entry points only; never grant to browser roles.
revoke all on function private.legacy_scope_tables()
  from public, anon, authenticated, service_role;
revoke all on function private.legacy_scope_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function private.backfill_legacy_shop_rows(jsonb)
  from public, anon, authenticated, service_role;
commit;
