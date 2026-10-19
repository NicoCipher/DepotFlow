# DepotFlow M2 — Phase A database-first deployment preparation (19 October 2026)

> **PREPARED, NOT AUTHORIZED.** This file does **not** approve, execute, schedule or merge a production deployment. PR #107 stays Draft. Walnik Ventures is the first existing business. Preserve its customers, stock, empties, sales, payment records, money owed, receipts, and existing user/session.

## Fixed release boundary

- Production project: `coyivbklakhilpcqqrzg`, PostgreSQL 17.6, free existing project; **never create a paid branch/project**.
- Production migration ledger: exactly **56 existing migrations** ending at `20261019132131_depotflow_hosted_auth_signup_closed_guard_20261019`. Re-fetch read-only immediately before any release, **require every ordered version and migration name to match** `supabase/tests/fixtures/production_migration_history_20261019_after_auth.json`.
- The already-deployed Auth-only source `20261018112000_stage_auth_side_signup_hook.sql` MUST NEVER replay.
- **Phase A ONLY:** exactly **65** forward-only SQL migrations, with canonical filenames in `supabase/tests/fixtures/m2_forward_only_sources_20261019.json`, from `20261019140000_private_business_membership_foundation.sql` through `20261019140104_generate_legacy_assortment_ids_and_replay.sql`. Copy **source SQL bytes unchanged**; only forward-assigned filenames change.
- **Phase B EXCLUDED:** `20261018124000_finalize_legacy_creation_api_cutover.sql` may not be present in the Phase A SQL directory or apply sequence. Its temporary `test_only` identity is **not** a production version, and must not be adopted without later distinct owner approval.
- The managed Auth Before User Created hook is operator-reported enabled; the private gate stays **OFF**. Existing-user sign-in is operator-confirmed; direct live `/auth/v1/signup` denial was explicitly **deferred by owner**. Never claim this deferred check passed, open signups, or enable the business activation flags.
- PR #107 includes application changes; **do not merge application changes before compatible database routines exist** in hosted production. The live original-shop create paths must continue operating between Phase A and application cutover.

## Exact zero-additional-cost preparation (offline output, never deployed)

Use a clean, reviewed checkout of the exact approved PR head and obtain a **fresh read-only** migration ledger JSON from production into a protected **temporary local file**, not the public repository. Structure: `{"versions":["<56 ordered timestamps>"],"names":{"<version>":"<migration name>",...}}`. The connected Supabase `list_migrations` output can be converted manually/with a reviewed read-only helper; do not paste credentials, customer records or SQL bodies into public CI artifacts.

```sh
# Use an external, empty directory. The builder refuses existing output.
python3 scripts/build-forward-only-bundle.py \
  --remote-history /tmp/depotflow-fresh-production-migrations.json \
  --out /tmp/depotflow-reviewed-phase-a
# Review generated audit in /tmp/depotflow-reviewed-phase-a-rehearsal-audit.json
# Count and inspect without applying:
find /tmp/depotflow-reviewed-phase-a -maxdepth 1 -type f -name '*.sql' | wc -l
```

Expected: 65 SQL files, all SHA256s equal to their reviewed originals, one manifest located alongside the SQL directory, **no Phase B, no Auth-only SQL**, no additional or duplicate version, no unknown migration source. The generator **does not connect to production**. A preview output must not be confused with permission to execute.

## Strict NO-GO checks before authorizing Phase A

1. Fresh 56-entry ledger and the exact reviewed source SHA/source lock are unchanged; all latest required PR CI checks pass on the **same** SHA. No new migration or PR drift.
2. Independently compare the actual hosted schema's relevant public/private objects, routine ACLs, RLS policies, triggers, default privileges, table and column grants, role inheritance, Auth/Storage managed dependencies against an isolated production-equivalent PostgreSQL 17 environment. The current **minimal** PG17 historical reconstruction matches app-client DML/DELETE + legacy policies/triggers, but **is not** a complete managed Supabase schema clone. Do not infer full parity from the green rehearsal. Investigate any *unexplained* difference; never grant permissions broadly just to make a test green.
3. Back up existing production data and a protected schema-only snapshot through an authorized, restorable path, confirm restoration steps and the appropriate maintenance window. A rehearsal snapshot is not a replacement for a real backup.
4. Privately capture (but **do not publish**) pre-deployment Walnik checks: immutable IDs, existing owner and memberships, table counts and linked foreign-key invariants for sales/payments/debts/stock/empties/receipts, and whether old customer/crate/product create APIs are still callable.
5. Ensure Auth/private signup gate and all new-business activation flags remain **OFF**; no public registration or tenant activation during schema staging. Any Auth side effect or extra user is a stop condition.
6. Obtain **separate explicit owner authorization for the exact database-only Phase A action**, not an approval implied by this preparation file or by passing CI. A separate subsequent approval is required before application merge and Phase B cutover.
7. If direct live GoTrue signup denial remains deferred, retain the hosted-Auth review as an unresolved known release gate. Do not silently accept the risk or close it.

## Future deployment sequence — NOT executed

1. Under an operator-controlled change window, re-run the read-only preflight and ensure production backup/rollback recovery is accessible.
2. Stage/apply exactly the canonical Phase A SQL in dependency order against the correct existing production project, using a reviewed, individual migration-ledger recording path and **no** `supabase db push`, `db reset`, migration repair or blind repo-wide migration glob. Stop on **any** SQL error/ledger divergence. Do not grant old-create permissions away.
3. Read-only postflight: ledger exactly 56+65=**121** ordered migration identities, compare known pre/post business-record and balance invariants without publishing row data, preserve existing owner, check old-client operations and retry safety. Make sure the private gate and feature flags remain OFF and legacy create APIs still work.
4. Only after old-client compatibility and new RPCs are live and verified, separately authorize the compatible Vercel application release/merge. Prove ordinary customer/crate/product create, checkout, split tender, returns, stock and debt workflows with synthetic or expressly approved test records.
5. **Phase B is not part of this release.** The old creation API revoke/finalize requires a separate, explicit cutover approval **after** app deployment/verification.

## Stop / recovery rules

- Any unexpected ledger, permission, data/stock/debt/receipt invariant, Auth count, unexpected new signup, or owner isolation change → **STOP**; leave Auth and new-business gate OFF and Phase B unexecuted.
- No unreviewed reverse/drop/delete operations in production to force a pass. Roll forward with an independently reviewed repair and preserved evidence if needed; restoring data requires the authorized recovery procedure.
- Do not claim **merge-ready** until managed-platform verification and required Auth security controls are independently established. The previously deferred direct hosted signup probe is still outstanding.

## Evidence

- `docs/m2-hosted-schema-permissions-audit-20261019.md`
- `docs/release-evidence/production-schema-fingerprint-20261019.json`
- `docs/release-evidence/production-app-client-column-dml-acl-20261019.json`
- `docs/m2-forward-only-phase-a-rehearsal-20261019.md`
- `supabase/tests/fixtures/m2_forward_only_sources_20261019.json`
- `scripts/build-forward-only-bundle.py`

This plan should be revised only for a proved security or deployment incompatibility, not for unrelated features or minor styling work.
