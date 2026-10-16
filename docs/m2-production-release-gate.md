# DepotFlow M2 — production release gate

Status: **NO-GO — history reconciliation required.** This is a deployment runbook, not a migration approval.

## Evidence captured 16 October 2026

- Deployed Supabase project was inspected with read-only `list_migrations`. **47** versions applied. Latest: `20261015233039_shop_drink_lifecycle`.
- At the same instant, repository `main` contained **44** migration SQL files. Only **9** of those versions coincide with the remote migration history. **38** recorded remote versions are absent locally; **35** local historical versions are absent remotely.
- Several production changes have been applied under newer versions than their repository-file timestamps. We **cannot assume** a normal `supabase db push` will skip the correct files or reproduce the real database, even though those database structures appear present.
- Captured read-only remote versions: `supabase/tests/fixtures/production_migration_history_20261016.json`. Treat as an aging snapshot, **not** a live authority at deployment time.
- All **15 additive M2 migrations** on the integration PR were re-ordered to `20261016020000` through `20261016021400`, strictly newer than the last known applied production version, in their dependency order.
- Disposable PostgreSQL CI checks SQL compatibility, three-owner isolation, reporting and revoked-owner access, real concurrency and catalogue migrations; it does **not** prove upgrade-safe migration history or guarantee live data consistency.

## Required release steps (all mandatory)

1. Freeze production database migrations while preparing the cutover. Capture a new, trusted read-only `list_migrations` export and confirm the exact current deployment SHA, project, owner and timestamp. If changed, restart release preflight.
2. Before attempting any DDL, reconcile the existing 38/35 migration-version differences **one by one**. Gather the original deployment logs and compare the actual SQL, resulting schema objects, triggers, policies and function definitions. These names/versions may differ while the schema changes are equivalent; **do not declare equivalence from a filename alone**.
3. Decide how to establish a canonical history that can be reproduced, **with a separately reviewed reconciliation plan**. Do not run `supabase migration repair`, `db push --include-all`, `db reset --linked` or replay historical migrations merely to suppress history errors. Those operations could reapply sale/payment/crate logic or misrepresent already-applied data.
4. Use a **fresh, isolated database clone of actual production schema and realistically sized anonymized data**. Back up and verify ability to restore before touching production; do not copy sensitive live data into public CI. Test the exact planned migration mechanism, applied-history behaviour, locks and realistic rollback/forward-recovery steps on that clone.
5. Confirm all new timestamps are strictly after the **fresh** maximum remote version; reject missing/duplicate/retrograde versions. Run:
   `python3 supabase/tests/check_migration_versions.py`
   and `python3 supabase/tests/check_tenancy_release_order.py --remote-history /secure/path/to/fresh-history.json`.
   A failed history check is a **release stop**, not a prompt to add flags. The checker does not use network or mutate a database.
6. Record and compare audited inventories before and after any legacy backfill: original business/owner, every tenant-scoped table count and `business_id`, customer balances, all payment/receipt totals, sale item counts, physical bottles and branded empty crates, bottle obligations, idempotency records and valid anonymous receipt tokens.
7. Do not add a second business until the original singleton's backfill, **all 31 tenant FK validations**, active legacy authorization and subsequent replay/error tests have succeeded on clone and release candidate. Never import Walnik's test-shop records into a new official shop.
8. Run two real signed-in owners and a revoked owner against API endpoints and database functions. Test malicious cross-business IDs, concurrent sale/stock changes, partial returnable bottles, exact branded crate obligations, payment split and old debts, idempotency, abandoned uncertain saves, and anonymous receipt verification. Verify customer-facing mobile/desktop interaction and reverse navigation before public onboarding.
9. Deploy to a separately verified environment before production. Use an approved change window, backups, monitoring for authorization and financial errors, rollback/forward-recovery owners and documented cutover success criteria.

## Current boundaries

Existing shop transactions still use singleton and global identifiers for stock, catalogue configuration, sales, payments, bottles and crates. M2 permissions deliberately do **not** enable full multi-business sales. A successful integration PR or schema migration alone **does not** mean official Walnik onboarding is safe.

## Incentive and failure analysis

A rushed second signup may demo quickly, but can corrupt ownership of stock, historical debt, or returned empties and permanently undermine trust. Protect ledger provenance and reversible cutover over shipping a reassuring UI. Keep migration repair manual, separately audited and backed by evidence; do not hide mismatches from release checks.
