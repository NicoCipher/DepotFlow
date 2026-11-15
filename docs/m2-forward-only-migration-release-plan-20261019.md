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

The new `business_sales_gate` is created OFF by default. Public registration remains closed. No production migration, gate, grant, user or business record was changed by this work. The staged sales writer is not ready for deployment until its full test suite, application workflow, invitation path, production-schema rehearsal and separately approved release process are complete.

