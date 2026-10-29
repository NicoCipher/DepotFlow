# M2 migration source audit — 2026-10-29

Status: **PRELIMINARY SOURCE REVIEW — NOT A PRODUCTION-CLONE REHEARSAL; NO RELEASE AUTHORIZATION**

Scope: read-only inspection of the currently committed M2 source migration files on `main`, the checked-in forward-only release inventory, the production migration ledger, and a metadata-only query of live production schema. No SQL was applied to production. No migration repair, schema change, data change, signup activation, merge, or deployment was performed.

## Verified baseline

- Live Supabase migration ledger: 121 entries; tip `20261019140104_generate_legacy_assortment_ids_and_replay`.
- The first 55 production ledger entries match the checked-in 55-entry applied-SQL manifest in ordered version/name pairs.
- The hosted Auth migration is separately recorded as `20261019132131_depotflow_hosted_auth_signup_closed_guard_20261019`; its source is `supabase/migrations/20261018112000_stage_auth_side_signup_hook.sql`.
- The 65 Phase A tenant migrations in the forward-only inventory map one-to-one to the 65 production version/name targets from `20261019140000` through `20261019140104`.
- Current production metadata query found 65 relations, 410 columns, 385 constraints, 134 indexes, 36 policies, 48 non-internal triggers, and 100 functions in `public` and `private`.
- The same query found 31 unvalidated foreign-key constraints in those schemas. That is not proof of invalid existing data, but it means the affected constraints have not yet been validated against all existing rows.
- The 10 inspected onboarding/setup gate rows were disabled at the time queried.
- Production has not been cloned. Existing CI uses a fresh disposable PostgreSQL 17 database and is not evidence of a faithful production restore.

## Migration-by-migration source review (selected high-risk instructions)

This is an initial static review, not a complete semantic equivalence review of all 121 historical instructions. SQL patterns inside function bodies are runtime behavior and must not be confused with statements executed immediately by the migration.

| Source migration | What source inspection shows | Rehearsal requirement / risk |
|---|---|---|
| `20261016020000_private_business_membership_foundation.sql` | Adds private business/membership foundation tables. Comments say additive; it does not itself enable tenant login. | Check pre-existing names/objects and grants in restored baseline. |
| `20261016020100_link_legacy_test_shop_business.sql` | Links the existing legacy/test workspace to a business identity; source comments say no shop data moves. | Verify target owner and business identity in clone; no live backfill during rehearsal against production. |
| `20261016020200_add_business_identity_to_tenant_tables.sql` | Adds business identity across tenant-owned operational tables; nullable columns are intentional at this stage. | Check every expected table/column and null distribution; ensure later scoping and constraints occur in intended order. |
| `20261016020300_guarded_legacy_scope_backfill.sql` | Installs guarded/admin-invoked backfill tooling and guard triggers; source has precondition checks and advisory locking. | Test approved snapshot, wrong owner, missing linkage, duplicate/missing rows, concurrent writes, and rollback. Do not invoke its backfill on production as part of this audit. |
| `20261016020400_tenant_aware_relationships.sql` | Adds tenant-aware relationships and explicitly checks the expected count of 31 existing shop-owned FK relationships; comments warn NULL business IDs can bypass composite FK protection. | Verify the exact expected relationships and null/duplicate data on clone. Check that each relationship pairs the same business ID, not only matching record IDs. |
| `20261016020500_legacy_operational_write_scope.sql` | Adds legacy write-scope gate/functions and associated guard behavior. | Test owner active/inactive, gate enabled/disabled, non-owner and foreign-business calls, plus rollback and lock behavior. |
| `20261016020600_gate_legacy_owner_reads.sql` | Changes legacy owner-read policies/functions. | Compare all affected policies, security-definer functions and grants; test cross-tenant reads as authenticated users. |
| `20261016020900_nonlegacy_business_profiles.sql` | Adds per-business profile structures, functions, policies and triggers. | Confirm profiles remain isolated and that a new profile cannot claim the legacy business or another business's identity. |
| `20261016021000_tenant_customer_access.sql` through `20261016021200_legacy_customer_reader_scope.sql` | Changes customer access and legacy customer-reader scope, including privileged reads that RLS alone may not constrain. | Test direct table reads and every SECURITY DEFINER customer-reader entrypoint using two business identities and foreign UUIDs. |
| `20261016021400_guard_legacy_write_rpc_entrypoints.sql` | Adds authorization checks at legacy write RPC entrypoints, intended to fail before validation/state probes reveal data. | Assert uniform denial behavior for foreign IDs, unauthorized actors, malformed requests and missing records. |
| `20261016021500_tenant_inventory_read_barriers.sql` | Adds two functions and eight policies for inventory read barriers. | Run actual two-business inventory isolation tests; compare policy USING/WITH CHECK expressions and function definitions. Existing CI test pass alone does not prove the whole production baseline. |
| `20261017140200_tenant_physical_empty_stock_key.sql` | Adds `stock_id` UUID to `public.empty_bottle_stock`, drops/replaces its primary key, and installs a trigger/function to protect identity. Comments say new-business writes remain blocked. | High risk: rehearse PK swap, existing-row preservation, FK dependencies, trigger behavior, and rollback. Confirm every legacy NULL-business row retains its prior counting behavior. |
| `20261018094000_stage_tenant_physical_opening_inventory.sql` | Adds staged physical-opening gate/line tables and an RPC; seeds the gate disabled and revokes direct execution. | Check no checkout/deposit/sale path is unintentionally enabled; test atomicity with stock-count audit events and retries. |
| `20261018095000_validate_tenant_bottle_count_identity.sql` | Adds deeper validation to the underlying business bottle-count RPC, not only the wrapper. | Test direct invocation, unowned bottle type, inactive/missing product, cross-business identity and invalid counts. |
| `20261018105000_stage_owner_business_selection.sql` | Adds staged owner business-picker state/function, described as not enabling signup/provisioning. | Verify it cannot reveal or select a business without active membership; check gate remains disabled. |
| `20261018110000_stage_self_service_business_registration.sql` | Adds registration structures/functions and an initially disabled registration gate. The registration RPC writes business, membership, profile and request-audit rows atomically; comments say it creates no stock/customer/sale/checkout rows. | High risk: test email verification, retries/idempotency, concurrent duplicate requests, identity reservation, all-or-nothing rollback, and no unintended onboarding. Keep gate disabled. |
| `20261018114500_reserve_immutable_registered_depot_identity.sql` | Adds safeguards to preserve original registered depot name/location identity. | Test profile edits cannot free or claim another depot's reserved identity. |
| `20261018121000_generate_legacy_customer_ids_and_replay.sql` | Adds request/idempotency storage and a legacy customer-creation RPC that generates IDs server-side; creates the legacy cutover gate disabled. | Test retries, caller-supplied UUID attempts, collision cases and compatibility with the deployed old application. Do not revoke old creation paths until the application cutover is explicitly approved. |
| `20261018123000_generate_legacy_assortment_ids_and_replay.sql` | Adds request/idempotency storage and server-generated crate/product IDs; adds `deposit_id` to crate deposit prices and replaces its primary key. Source comments say existing IDs, stock, empties, prices, edits and history are not rewritten. | High risk: rehearse PK replacement, dependency handling, exact preservation of legacy IDs and all dependent stock/empty/price/receipt records. SQL DELETE statements found in this file are within RPC function bodies; do not count them as migration-time data deletion without parsing the complete SQL. Test the runtime delete behavior separately. |
| `20261018124000_finalize_legacy_creation_api_cutover.sql` (separately staged Phase B, not recorded as applied) | Requires transaction-scoped operator consent, an authorized cutover gate, disabled new-business setup gates, and replacement RPCs; then revokes direct customer/product inserts and old crate-creation RPCs. | **Do not apply during this rehearsal or database-first stage.** First verify the deployed application uses replacement RPCs and that hosted login and legacy create/edit flows work. Test an approved cutover only in a clone. |

## Current concrete release risks

1. **31 unvalidated foreign keys:** obtain their full definitions and run non-mutating anti-join checks on the restored clone to determine whether any existing rows violate each intended relationship. Then rehearse validation. Do not validate them in production as an exploratory step.
2. **Primary-key changes:** `empty_bottle_stock` and `crate_deposit_prices` have key-replacement logic. Verify referencing foreign keys, indexes, duplicate rows, and legacy NULL-business rows on the clone before any production operation.
3. **Security-definer and RLS equivalence:** compare actual function definitions, policies, triggers, grants and role behavior, not just filenames or SQL checksums.
4. **Old-app compatibility:** the final creation-API cutover is deliberately separate and gated. Do not revoke legacy insert/RPC access until the production app's RPC compatibility is independently verified.
5. **Onboarding is staged:** gates queried were disabled. Do not activate signup or onboard a new real business before the release gate is approved.

## Required next test plan

1. Obtain a verified, restorable production backup or a schema export plus suitably anonymized representative data. Keep customer/business information protected.
2. Restore it into an isolated PostgreSQL 17 environment; record the backup timestamp, PostgreSQL version, extension versions and restore outcome.
3. Capture a pre-replay object inventory: relations, columns/defaults, constraints/validation state, indexes, RLS flags, policies, functions (including full definitions), triggers, grants, extensions and migration ledger.
4. Replay the exact candidate SQL sequence against the clone only. Stop at the first failure; do not skip or repair migrations to force a pass.
5. Run anti-join checks for each of the 31 unvalidated FKs, PK dependency/preservation checks, idempotency/retry tests, cross-tenant read/write denial tests, physical-empty lifecycle tests, and existing legacy app workflows.
6. Compare post-replay schema/object definitions against the expected inventory and report every diff with a reviewed disposition.
7. Separately rehearse the Phase B finalizer only after app compatibility prerequisites are evidenced. It is not part of the default database-first rehearsal.
8. Attach logs and checksums, obtain review, and reassess the release gate. No merge/deploy/production change is authorized by this report.

## Decision

**NO-GO.** Static source inspection has identified the high-risk operations and their clone test requirements. It has not yet proven safety against a restored production database. No production SQL was executed by this audit.
