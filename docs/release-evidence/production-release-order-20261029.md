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
