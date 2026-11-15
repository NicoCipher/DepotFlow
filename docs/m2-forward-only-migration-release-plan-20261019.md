# DepotFlow — forward-only M2 release packaging after live Auth security (19 October 2026)

**STATUS: REVIEWED REHEARSAL ONLY. NO PHASE A/PHASE B PRODUCTION APPROVAL.**

### Verified reality

The previously captured 55 applied migrations were followed by a **separate Auth-only production migration** (applied under the user's request to resolve hosted Auth security): `20261019132131_depotflow_hosted_auth_signup_closed_guard_20261019`. A read-only `list_migrations` now shows **56 entries** with exact names; the one existing Auth account remains in place. The new private gate is OFF and the `auth.users` insert guard is active. No new tenant features or Vercel application code have been deployed.

The old 55-version candidate is **invalid for further release**. Never replay the already-applied Auth SQL `20261018112000_stage_auth_side_signup_hook.sql`. No blind `supabase db push`, `--include-all`, `db reset --linked`, or migration repair.

### Updated canonical candidate

`supabase/tests/fixtures/production_migration_history_20261019_after_auth.json` records exactly 56 live versions and names, ending in `20261019132131`. The old 55 original SQL source records remain separately preserved as evidence.

Both `supabase/tests/fixtures/m2_forward_only_sources_20261019.json` and `docs/m2-forward-only-release-inventory-20261019.json` now freeze identical ordering:

- **Already installed:** Auth-only source; deliberately not included in the next package.
- **Phase A:** 65 remaining unmodified M2 SQL sources, assigned `20261019140000`–`20261019140104`, each strictly after the live ledger tip.
- **Phase B:** one separately gated legacy create-right revocation, `20261019140105`, only in its own optional test artifact; not an unattended database-first rollout.

`scripts/build-forward-only-bundle.py` produces only Phase A SQL; `scripts/build-forward-only-m2-release.py` separately packages Phase A and the denied-by-default Phase B test artifact. They compare the exact 56-version/name ledger and require both source inventories to agree, refuse any additional/unrecognized SQL, and place generated SQL only in disposable directories.

### Zero-dollar CI

The PostgreSQL 17 Actions job reconstructs 55 historical migrations, adds the Auth-only SQL as already-applied stage 56 in disposable databases, replays 65 forward-versioned Phase A SQL bodies, verifies original customer/crate/product creation, and checks synthetic stock/debt/receipt/empty-obligation invariants before and after. It tests the locked Phase B against unattended execution and simulates an expressly approved cutover only in the sandbox.

Existing managed Supabase role/column-level ACL differences mean that a green synthetic PostgreSQL reconstruction **is not an identical hosted production-schema clone**. The latest read-only hosted fingerprint, incorporating `SECURITY DEFINER` function execution privileges and schema usage, is in `docs/release-evidence/production-schema-fingerprint-20261019.json`. A true actual-schema/managed grants parity test is still a release gate.

### Hosted Auth still requires management-side verification

The gate table, Auth hook SQL routine and active `auth.users` insert trigger are installed, gate default OFF, Auth admin may call the hook, app roles cannot, synthetic hook input returns a 403 object, and the original Auth account count remains unchanged. This prevents ordinary new Auth-row insertion via GoTrue while the gate remains closed. It **does not prove** that hosted Authentication → Hooks → Before User Created is actually configured; the currently available Supabase connector has no action to inspect or set Auth management configuration. Nor does it certify a controlled direct hosted `/auth/v1/signup` request or existing-owner login. Those remain required before closing the hosted bypass review finding.

### Go/no-go

**NO-GO for PR #107 merge and Phase A deployment:** no actual production-schema clone with complete managed grants, no confirmed hosted Auth management settings or controlled direct API outcome, no validated confidential ledger backup/pre/post checks, no Phase A operator approval. Multi-business signup and activation remain OFF. The user-authorized isolated hosted Auth security installation is complete, but it is **not** authorization for tenant schema rollout or Vercel deployment. No new paid project, branch or infrastructure was used.

---

## 15 November 2026 addendum — later operational-writer work

This document's 56-entry baseline and 65+1 package describe the **19 October 2026 rehearsal only**. They are not a current production migration count or release certificate. A later read-only production audit found 124 applied migration records, ending at `20261104172847`; the 19 October source mapping must not be represented as a fresh live ledger.

Three later SQL migrations are staged on the dependent operational-writers branch and intentionally excluded from the dated 65+1 rehearsal package:

- `20261115090000_stage_tenant_customer_payments.sql` — tenant customer-payment writer.
- `20261115100000_stage_operator_business_invitations.sql` — controlled operator invitation/provisioning.
- `20261115110000_stage_tenant_business_sales.sql` — tenant-scoped sales writer and business-specific receipt snapshots.

Their exact Git blob identities and reasons are recorded in `reviewed_excluded_sources` in `supabase/tests/fixtures/m2_forward_only_sources_20261019.json`. This exclusion only keeps later staged work out of the historical rehearsal; it does **not** approve deployment, mark the migrations applied, or authorize production changes.

The new `business_sales_gate` is created OFF by default. Public registration remains closed. No production migration, gate, grant, user or business record was changed by this work.

### Current release reality — 15 November 2026

The 65 Phase A M2 foundation migrations are already present in the current production ledger (versions `20261019140000` through `20261019140104`). Do not replay them. Production now has 124 migration records and the live tip is `20261104172847`; the dated 56-entry snapshot above is historical evidence only and cannot authorize another release.

The current staged operational sequence has four SQL files newer than the live tip:

1. `20261115090000_stage_tenant_customer_payments.sql`
2. `20261115100000_stage_operator_business_invitations.sql`
3. `20261115110000_stage_tenant_business_sales.sql`
4. `20261115120000_validate_tenant_foreign_keys.sql`

The first three are developed in the dependent PR stack; the FK validation migration is already staged on `main`. Their order is the repository's timestamp order. The invitation migration's exact blob hash is pinned in the exclusion inventory with an updated reason; it remains excluded from the old 65+1 rehearsal and is not production-approved.

A fresh read-only 124-version/name snapshot is captured at `supabase/tests/fixtures/production_migration_history_20261115_readonly.json`. A new release candidate must bind to that snapshot (and obtain another live read immediately before any release), replay the actual post-56 production migrations in a disposable PostgreSQL 17 reconstruction, apply these four staged migrations in order, and verify the exact hosted schema/role differences and the Auth invitation behavior. The old 56-version builder is not a valid release builder for this candidate. No `db push`, history repair, migration application, gate activation, Auth invitation, or production deployment is authorized by a green disposable test.

The new-business UI also remains disabled in production: `NEXT_PUBLIC_BUSINESS_SALES_ENABLED` is not configured, and `private.business_sales_gate` does not yet exist in the live database. The invitation, payment and sales writers are not ready for production use until the current-ledger release candidate, real hosted GoTrue invitation test, production-schema rehearsal, and separate operator approval are complete.

The current 124-stage hosted schema was also captured using SELECT-only metadata queries on 15 November:

- `docs/release-evidence/production-schema-fingerprint-20261115.json`
- `docs/release-evidence/hosted-schema-per-object-digests-20261115.json`
- `docs/release-evidence/production-app-client-column-dml-acl-20261115.json`
- `docs/release-evidence/production-function-parity-20261115.json`

The updated disposable PG17 workflow now reconstructs the 124-stage history (56 historical/Auth + 65 installed M2 sources + 3 later production-applied SQL sources), compares the reconstructed schema and application-client DML/effective DELETE permissions to those current hosted snapshots, and only then applies the four staged operations migrations. It asserts all 31 tenant foreign keys are validated, the public-signup/customer-payment/sales gates remain OFF, and the rollback-only payment, invitation, sales and relationship tests pass. This current-history rehearsal passed on 15 November 2026 in GitHub Actions run `43732681426`: the 124-stage reconstruction matched the hosted schema and application ACL snapshots, all four staged operations migrations applied in disposable PostgreSQL 17, all 31 tenant foreign keys validated, all three gates stayed OFF, and the rollback-only maintenance, payment, invitation, sales and relationship tests passed. This is a disposable rehearsal only, not production deployment approval.



### Consolidated review path

PR #175 is the active consolidated candidate for the Walnik pilot release. The earlier stacked drafts #162, #163 and #165, and interim consolidation drafts #169–#174, are superseded and must not be merged independently.


The disposable bootstrap now defines the managed `public.rls_auto_enable()` stub with the hosted `SECURITY DEFINER` and `search_path=pg_catalog` metadata. This is a test-only fidelity correction; it does not modify the live Supabase function.


The current-schema comparison checks function owner, SECURITY DEFINER, direct ACL, role-specific EXECUTE, schema USAGE, `proconfig`, and a normalized hash for the legacy `private.record_payment` body. The disposable `public.rls_auto_enable()` stub mirrors the hosted security metadata; its managed body is not treated as application source.


The disposable RLS event-trigger stub uses a single-quoted PL/pgSQL body (`BEGIN END;`) so the test bootstrap does not depend on dollar-quote parsing. Its `SECURITY DEFINER` and fixed `pg_catalog` search path match the hosted metadata.


The consolidated app verification passed in run `43732681287` (lint, domain tests, safety regressions, type-check and build). The two-owner browser acceptance passed in run `43732681340`: separate depot sessions remained isolated; a test sale recorded ₦8,000 total, ₦3,000 received and ₦5,000 owing; the receipt opened, and cross-owner direct access returned 404.
