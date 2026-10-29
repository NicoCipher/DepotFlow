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
2. **First candidate: `20261029103000_revoke_client_maintenance_privileges.sql`.** The live ACL snapshot shows `anon` and `authenticated` retain `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` on `public.sale_empty_decisions` and `public.shop_profile`. RLS does not protect `TRUNCATE`. The new migration checks the expected pre-state, revokes only these maintenance privileges, and verifies intended SELECT access remains. It is staged for review only; not applied to production.
3. **Second candidate: `20261029110000_stage_legacy_bulk_price_updates.sql`.** It is strictly newer than the current live tip and depends on the M2 business identity and owner guard that are present. It must follow the ACL hardening migration and may be considered only after its SQL, business isolation, price-history behavior, app checks, and production release preflight are approved.
4. **Keep M2 Phase B deferred.** Do not run `20261018124000_finalize_legacy_creation_api_cutover.sql` at its original timestamp: it is older than the live tip and is not recorded as applied. After the new app has demonstrably switched to the replacement creation RPCs, the operator must review a new forward-only migration version, obtain fresh explicit approval in the same transaction, and release it separately. The current live gates must not be enabled as part of the bulk-price migration.

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


## Archived-original line-by-line disposition — 2026-10-29 follow-up

I inspected all four preserved original applied-SQL evidence files against the similarly named repository candidates. These files remain inert evidence; none was copied into the migration directory or executed.

| Applied version | Result of direct source review | Disposition |
|---|---|---|
| `20260925113009_product_images` | Original creates/uses the public `product-images` Storage bucket and creates authenticated Storage-object INSERT/DELETE policies guarded by `public.is_shop_owner()`. No unique executable source migration was found by repository search. | Historical SQL preserved with recorded MD5 `90ea13d53f3745d4904657563eefd001`; source provenance unresolved. Compare live Storage bucket/policies and intended Storage state separately; do not replay. |
| `20260927154550_customer_archiving` | Applied SQL adds `customers.archived_at`, grants column UPDATE, and defines `private.save_sale(...)`. The closest source candidate adds a final `REVOKE ALL ... FROM public,anon,authenticated` that is **absent from the preserved applied SQL**. | Confirmed substantive SQL difference, not a whitespace-only variation. The later source revoke cannot be credited to this applied migration. Current live catalog previously showed that old `private.save_sale(...)` signature is absent, so this historical difference does not alone prove a currently callable routine. |
| `20261001022503_join_bottled_desperados_catalogue` | Original is a guarded transaction: locks catalogue/product/cost-history/selling-price-history tables, verifies Desperado/Desperados identities, merges catalogue references, and checks protected product/stock/can data with hashes before commit. No unique equivalent source file was found. | Historical SQL preserved with MD5 `ed0546e85bb295d6615e25b77461a759`; source provenance unresolved. Do not recreate or rerun this data migration without its original state and explicit data review. |
| `20261014072834_sale_with_old_debt_payment` | Applied SQL defines the atomic old-debt-plus-sale RPC and its authenticated EXECUTE grant. The similarly named `20261014110000_sale_with_old_debt_payment.sql` instead includes receipt-snapshot work and is not the same migration. That local source maps to a different later live migration. | Confirmed distinct historical purpose. Original preserved with MD5 `6ccd363e6b69a8831931b9515e8499db`; keep the two migration identities separate. |

This closes the **manual inspection pass** for the four archives, but not the full provenance requirement: their original text is now characterized, while exact semantic state correspondence still requires replay/AST review and comparison against the intended production schema. No archive is certified as a replayable migration.

## Verification on the audit documentation commit

The database and app verification workflows for commit `14dd1d4cc504ccfe52375cc314c4a11a7509d001` both completed successfully. This verifies repository checks and the disposable PostgreSQL 17 rehearsal. The workflow's own output explicitly describes its rehearsal as **not** a live-schema, fresh-ledger, or production-release certificate. CI success therefore does not change the NO-GO decision.

## Read-only AST provenance and exact 121-stage schema comparison — 2026-10-29

This section supersedes the earlier "Next required evidence" item asking for a PostgreSQL-aware first-pass comparison of the 22 lexical-only mappings. It does **not** supersede the production NO-GO decision.

### Original applied SQL evidence

- A read-only query retrieved the original recorded statement arrays for all 22 previously lexical-only migration versions (206 recorded statement-array entries parsed into 263 top-level SQL statements (the local source candidates parse into 271 because four source files include outer BEGIN/COMMIT wrappers absent from the recorded arrays)).
- Evidence file: `docs/release-evidence/production-applied-sql-statements-lexical-only-20261029.json`.
- AST report: `docs/release-evidence/applied-sql-ast-comparison-20261029.json`.
- The PostgreSQL parser audit reports 17 direct AST matches, 4 cases where the recorded applied array omits the source file's paired outer `BEGIN`/`COMMIT` wrappers while all inner AST nodes match, and 1 case where the only difference is full-line comments inside a PL/pgSQL body. There are zero parse errors, missing source candidates, or unresolved AST differences.
- This improves historical SQL provenance confidence, but is not a full runtime-semantic or managed-platform certificate. The four archived originals remain inert evidence and are not replayable migrations.

### Exact current-state reconstruction comparison

- Production metadata was captured read-only with `supabase/tests/fixtures/current_schema_parity_fingerprint.sql` and stored in `docs/release-evidence/production-schema-parity-fingerprint-20261029.json`.
- The isolated PostgreSQL 17 comparison reconstructs 55 historical migrations + the hosted Auth guard + 65 forward-only Phase A stages, corresponding to the current 121-entry ledger tip. It does not connect to production and does not include customer rows.
- Comparison report: `docs/release-evidence/current-schema-parity-comparison-20261029.json`.
- Matching categories: 410 columns, 385 constraints, 134 indexes, 36 policies, 48 triggers, and 2 schemas. The reconstruction also contains 67 relations and 100 functions, matching the production inventory counts.
- Remaining differences: 28 relation metadata objects, 28 column-grant groups, and one function definition. Sample relation differences are effective `service_role` `REFERENCES` and `TRIGGER` privileges present in production but absent from the minimal PG17 bootstrap. The matching column-grant differences are consistent with those two extra privileges per affected table. `public.rls_auto_enable()` differs because production has a SECURITY DEFINER/configured managed function while the disposable bootstrap uses a non-definer stub.
- These are identified platform-emulation differences, **not certified harmless**. Confirm the intended production role privileges against the managed Supabase model. The earlier RLS review items remain open: `public.known_empty_crates`, `private.customer_empty_returns`, and `private.held_empty_collections` have RLS disabled and no matching policy entry in the inspected catalog.

### Current release decision

**NO-GO.** The historical AST comparison has no unresolved differences, but full schema/grant parity is not certified because of the managed-role and managed-function differences above and the unresolved RLS access-model questions. Keep PR #154 draft/unmerged. Do not set `release_authorized=true`, repair the migration ledger, apply migrations, enable gates, merge, or deploy based on this evidence.

CI diagnostic run: https://github.com/NicoCipher/DepotFlow/actions/runs/40874241883  
A green workflow run means the isolated tests passed; its parity step still reports NO-GO for the live-versus-reconstruction comparison.

All production queries were read-only. No production schema, permissions, data, migration ledger, gates, or deployment were changed.



## ACL hardening finding — 2026-10-29

A fresh read-only ACL expansion confirmed direct grants of `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` to both `anon` and `authenticated` on `public.sale_empty_decisions` and `public.shop_profile`. These are not required for application SELECT/RLS behavior. A new forward-only candidate, `20261029103000_revoke_client_maintenance_privileges.sql`, now fails closed unless the captured pre-state matches, revokes only these four privileges from the client roles, and asserts that intended authenticated SELECT remains and anonymous SELECT remains denied. Its regression test is included in the disposable PG17 workflow. This migration is staged but **not applied to production**.

The exact-current 121-stage reconstruction uses a separate, clearly labeled disposable-only fixture to reproduce the pre-fix ACL snapshot for comparison. The migration is then rehearsed against that clone after the current-state fingerprint is captured. The pre-fix grants are not treated as safe; they are explicitly recorded as the reason for the first forward-only release candidate.
