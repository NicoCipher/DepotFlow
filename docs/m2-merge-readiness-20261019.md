# DepotFlow PR #107 — merge readiness evidence (19 October 2026)

**Status: NOT APPROVED TO MERGE OR DEPLOY.** This file records completed zero-cost release tests, not a substitute for the production release checklist. All new-depot activation and signup gates remain OFF.

## Latest passing zero-dollar test evidence

- [PG17 database workflow 39224047594](https://github.com/NicoCipher/DepotFlow/actions/runs/39224047594): **PASS** at `1baf54e38100fff73639b20880d08e1cce5e03eb`.
- [Application CI 39224047540](https://github.com/NicoCipher/DepotFlow/actions/runs/39224047540): **PASS**, same commit.
- [Real local GoTrue 39224047617](https://github.com/NicoCipher/DepotFlow/actions/runs/39224047617): **PASS**, same commit. It verifies direct signups denied by Auth, gate transition races, email confirmation, and confirmed-user login while signup closed.

The database workflow creates two disposable, data-free PostgreSQL 17 reconstructions, built from the 55 original applied production SQL stages (not a supabase db push or production-data dump):

1. Auth-only staged migration installs and passes its owner-preservation / transaction-gate assertions against the reconstructed 55-stage live schema.
2. All **66 PR-added multi-business SQL migrations** apply successfully to another instance of the reconstructed 55-stage schema, in their original intended sequence: **55 + 66 = 121 SQL stages**.
3. Before the 66 stages, CI seeds **synthetic** original-shop owner, business profile, physical 24-pocket crate, product, 120-bottle stock, customer, ₦1,400 debt, eight empty crates, 19 empty bottles, customer empty obligations, original sale, receipt and stock movement. It hashes the original legacy values and compares the same source columns after migration. **The hash remains unchanged**. No live customer data entered CI.

A historical drift blocker was fixed, not suppressed: the local clean history has 26 owner-only read policies, while actual live PostgreSQL history has 27. `20261016020600_gate_legacy_owner_reads.sql` now accepts only the **fixed reviewed 27-table allowlist**, correct exact policy names, authenticated-only roles, original owner predicates, and additional per-user predicates on cost/price history. It validates 26 or 27 recognized policies, failing on a forged/new identity.

## Why 3 green checks do NOT approve the PR merge

1. **Actual hosted Auth remains unprotected by the drafted migration.** Read-only live catalog audit shows neither `private.depotflow_before_user_created(jsonb)` nor `private.business_auth_signup_gate` / insert trigger are deployed. Local GoTrue tests do not install the hook in hosted Supabase. Direct hosted `/auth/v1/signup` P2 must remain OPEN.
2. **Production migration ledger is not aligned with repository history.** There are 55 applied live versions and many local historical file timestamp/name differences. Source-body evidence is documented in `docs/m2-applied-sql-reconciliation-manifest-20261019.json` (29 byte-exact matches, 22 lexical matches, four archived originals). The 66-stage successful replay proves DDL *compatibility*, NOT that blindly running `supabase db push` will apply the intended changes safely. Do not automatically repair history or rename timestamps.
3. **Production is populated.** The new synthetic ledger preservation test proves non-empty data compatibility, but live receipt, debt, stock, bottle/crate obligation values still require pre/post checks, backups and authorized cutover. Avoid exporting private customer data to public CI.
4. **Main is live on Vercel.** The staged original-shop crate and product UI now depend on database-generated-ID RPCs that do not yet exist on production. Merging application code before installing and validating corresponding database functions would break genuine operations at Walnik Ventures.

## Safe merge plan at $0 additional infrastructure

1. Obtain **explicit authorization** for narrowly scoped, operator-attended production database/Auth changes. First install and validate the Auth-only gate (default OFF) and managed GoTrue Before User Created hook without enabling signups. Verify existing login, aggregate Auth user count, privileged function grants and controlled direct signup denial.
2. Reconcile the *version history* with a reviewed forward-only migration strategy anchored to the live 55-entry ledger; test the **exact files/versions** intended for live, not just the 66 unordered source bodies. Do not use unreviewed `db push`, `--include-all` or `migration repair`.
3. Compare protected actual Walnik financial/stock/empty-obligation invariants before and after the gated SQL rollout; validate all 31 tenant FK constraints, unchanged receipt identities and initial owner membership.
4. Only then merge the guarded application code to `main` after green CI/Codex on its exact SHA and verify production health. **Activation remains separate**: do not enable other-depot registration, public signups, checkout/returns or new business gates merely because foundation SQL was deployed.

No paid Supabase branch/project was created. No live SQL changes, customer edits, or Vercel deploys were performed in this work.

**Merge checklist:** Hosted Auth installed/verified ☐; applied migration-version plan approved/tested ☐; actual-data protected audit/backup ☐; final review/CI ☑; user production release authorization ☐.
