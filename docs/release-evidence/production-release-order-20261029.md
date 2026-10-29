# DepotFlow production migration reconciliation and release order

Captured: 2026-10-29  
Project: `coyivbklakhilpcqqrzg`  
Evidence: `supabase/tests/fixtures/production_migration_history_20261029_after_m2_phase_a.json`  
Status: **Ledger reconciled; production release is still NO-GO.**

## Reconciled live ledger

A fresh read-only Supabase migration listing returned 121 entries ending at `20261019140104`.

| Group | Count | Current status |
|---|---:|---|
| Historical application migrations | 55 | Already recorded |
| Hosted Auth signup guard | 1 | Already recorded at `20261019132131` |
| M2 tenancy Phase A | 65 | Already recorded as `20261019140000` through `20261019140104` |
| M2 Phase B legacy creation API finalizer | 0 | Not recorded; remain deferred |
| **Total live ledger** | **121** | Tip `20261019140104` |

The new read-only database checks confirm that `products.business_id`, `product_cost_history.business_id`, and `private.assert_legacy_assortment_owner()` exist. The bulk-price RPC does not yet exist. The cutover approval gate and new-business registration/selection gates are disabled. Authenticated access to the legacy creation RPCs and direct customer/product inserts is still present, so the old-app cutover is not complete.

## Approved sequence (order only, not deployment authorization)

1. **Do not replay M2 Phase A.** The 65 stages are already in the live ledger. Their original source filenames are historical source aliases, not pending production migrations.
2. **Next candidate: `20261029110000_stage_legacy_bulk_price_updates.sql`.** It is strictly newer than the current live tip and depends on the M2 business identity and owner guard that are present. It may be considered for release only after its SQL, business isolation, price-history behavior, app checks, and production release preflight are approved.
3. **Keep M2 Phase B deferred.** Do not run `20261018124000_finalize_legacy_creation_api_cutover.sql` at its original timestamp: it is older than the live tip and is not recorded as applied. After the new app has demonstrably switched to the replacement creation RPCs, the operator must review a new forward-only migration version, obtain fresh explicit approval in the same transaction, and release it separately. The current live gates must not be enabled as part of the bulk-price migration.

## Why production is still NO-GO

This reconciliation aligns the live **version/name ledger** with the reviewed M2 source sequence. It does not prove that every SQL statement historically applied is byte-for-byte or semantically identical to the local source. The prior evidence still classifies 22 historical matches as lexical-only and retains four original applied SQL files as checksum-verified archives. The current schema/grant observations are targeted spot checks, not a complete current schema and privilege parity report.

Therefore, do not set `release_authorized=true`, run migration repair, use `--include-all`, apply a migration to production, merge the feature PR, or deploy until the historical SQL provenance and full current schema/grant parity review are independently completed.

## Safety boundary

All production checks used here were read-only. No migration was applied, no migration ledger row was changed, and no business data or production application state was modified.


## Independent follow-up audit — 2026-10-29 (read-only, not release approval)

### Live ledger and historical SQL provenance

A separate read-only Supabase session reconfirmed **121** rows in `supabase_migrations.schema_migrations`, from `20260912230917` through `20261019140104`. The live ledger is consistent with the reviewed 55 historical entries + 1 Auth guard + 65 M2 Phase A entries. No ledger row was inserted, removed, renamed, or repaired.

The source-to-applied-SQL inventory remains **29 byte-exact, 22 lexical-only, and 4 original applied SQL archives**. A read-only query confirmed that the 22 flagged live ledger entries retain their original recorded statement arrays and statement counts; this follow-up did **not** upgrade their provenance classification. Lexical normalization is not a PostgreSQL parse-tree or semantic-equivalence proof. The four archived SQL records remain evidence for manual review, not executable migrations. Do not infer equivalence from names, timestamps, or hashes of differently normalized text.

### Current production catalog snapshot

A fresh metadata-only inventory over `public` and `private` returned the following broad counts:

| Catalog category | Live count |
|---|---:|
| Relations (tables/partitions/views/materialized views/sequences in the query scope) | 67 |
| Columns | 410 |
| Constraints | 385 |
| Indexes | 134 |
| Functions | 100 |
| SECURITY DEFINER functions | 79 |
| Policies | 36 |
| Non-internal triggers | 48 |
| `information_schema.column_privileges` rows across all grantees in these schemas | 2,186 |

These are **current inventory counts, not parity proof**. The 2,186 grant-row scope includes all visible grantees and is not directly comparable to the earlier 473-row hosted client/managed-reference inventory. The saved 19 October fingerprint is a pre-Phase-A baseline, so it cannot be used as the expected post-Phase-A schema without a deliberate, exact-version comparison.

The read-only spot check also found `public.known_empty_crates` has RLS disabled, has an `authenticated SELECT` table grant, and has no matching policy entry. `private.customer_empty_returns` and `private.held_empty_collections` also have RLS disabled and no matching policy entry in the inspected catalog. These may have an intentional access design, but that intent and the effective privilege paths must be proven against the exact intended schema; do not silently classify these as harmless drift.

### Gate and legacy-write observations

- `private.legacy_write_scope_gate`: zero rows; zero enabled rows. The bulk-price writer must continue to fail closed.
- `private.business_auth_signup_gate`: one row, `enabled=false`.
- The bulk-price RPC `public.update_legacy_product_prices(uuid,jsonb)` is still absent from production.
- The legacy `public.create_crate_type(...)` and `private.create_crate_type(...)` routines remain executable by `authenticated`; `public.save_sale_with_old_debt_payment(...)` is also executable by `authenticated`. This confirms the old creation/cutover surface has not been retired.
- No live data, grants, functions, gates, schema objects, or migration history were modified.

### Release decision after this audit

**Still NO-GO.** The provenance task is not complete enough to certify the 22 lexical-only mappings, and full schema/grant parity has not been demonstrated against a confidential, isolated PostgreSQL 17 reconstruction of the *current 121-entry production state* with Supabase-managed role inheritance/ACL behavior accounted for. The current metadata inventory identifies concrete items that must be reconciled, but does not explain them away.

Next required evidence:
1. Compare all 55 original applied statement arrays to source using a PostgreSQL-aware parser/semantic review, with explicit disposition for the 22 lexical-only mappings and four archived originals; retain any unresolved entry as a blocker.
2. Build a disposable PG17 reconstruction from the reviewed historical source plus exact forward-only Phase A sequence, with minimal managed-platform emulation documented. Compare per-object definitions, owners, SECURITY DEFINER flags, direct/effective ACLs, RLS, policies, triggers, and column grants against a fresh live metadata snapshot. Explain every mismatch, including the three RLS-disabled relations above.
3. Run the full preflight against the exact PR head and fresh ledger; obtain explicit release approval only if every required comparison passes.

Do not set `release_authorized=true`, run migration repair, use `--include-all`, apply any production migration, merge this feature PR, deploy, or enable gates based on this follow-up. The report is an audit record, not authorization.
