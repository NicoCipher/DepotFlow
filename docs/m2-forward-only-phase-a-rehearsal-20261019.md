# DepotFlow — forward-only Phase A release candidate (19 October 2026)

**REHEARSAL ONLY / PRODUCTION NO-GO.** This is a GitHub branch planning and zero-dollar verification artifact. It does not authorize production SQL, Supabase Auth settings, deployment, ledger repair or tenant activation.

## Exact baseline, not a guessed timestamp

The latest *captured*, read-only production migration ledger contains **55 ordered versions**, ending at `20261017132742`. The attached ledger includes their **55 names**, and `docs/m2-applied-sql-reconciliation-manifest-20261019.json` maps the matching SQL evidence (29 byte-exact, 22 lexical-only, 4 actual archived SQL). Local historical migration filenames and version numbers differ. Treat the ledger as an existing database fact; do not delete it, replace its rows, replay it, or blindly use `supabase db push --include-all` or `supabase migration repair`.

The 55-stage replay is a **reconstruction**, not an identical live Supabase schema clone: managed column privileges and certain functions still differ. Never describe passing a PostgreSQL 17 test as proof of hosted Auth or real-user data compatibility.

## Frozen first-release inventory

`docs/m2-forward-only-release-inventory-20261019.json` contains **exactly 66 Phase A source migrations**, in their established dependency order, plus **one separate Phase B file** that must never be part of the first database release:

- Phase A: `20261016020000_private_business_membership_foundation.sql` through `20261018123000_generate_legacy_assortment_ids_and_replay.sql`, 66 SQL bodies.
- Phase A rehearsal versions: `20261019000000_m2a_001_...` through `20261019010500_m2a_066_...`. All are higher than the last captured live version. No SQL text is modified; each file is copied byte-for-byte, with SHA-256 recorded in the generated audit.
- Excluded Phase B: `20261018124000_finalize_legacy_creation_api_cutover.sql`. Its original source timestamp is **not** a valid forward-only version for a post-Phase-A production cutover. A separately reviewed later version must be allocated only after app cutover and explicit operator authorization.

The generator **does not write into `supabase/migrations`**; it emits a sandbox-only directory. Existing PR migration files still conflict with live history; merely merging the branch or running the normal Supabase CLI could be unsafe.

## Exact free rehearsal and refusal conditions

In the disposable GitHub Actions PostgreSQL 17 workflow:

1. Rebuild 55 original production SQL stages from the SQL evidence archive in original ledger order, on a fresh isolated cluster.
2. Validate the 55 names and versions **exactly** against the frozen read-only baseline. Any unseen new version, renamed entry, missing entry, reordered entry, altered evidence mapping, unrecognized new source, or duplicate migration stops the packaging process.
3. Verify that the 67 PR-added SQL files match the frozen inventory using `git diff ... --diff-filter=A`; **66 Phase A only** are assigned newer versions. The old migration source SQL bytes are copied without amendment.
4. Create a separate disposable clone of the reconstructed 55-stage schema. Seed synthetic original-shop stock, sale, receipt, debt and empty obligations; record a fingerprint.
5. Apply the **forward-versioned** 66 Phase A files one by one. Run the authenticated old-app customer/crate/product creation compatibility test. Assert old grants still work and the creation cutover authorization remains OFF. Require the synthetic financial/stock/empty ledger fingerprint to remain unchanged.
6. Run unit tests against altered ledger names, extra versions, bad inventory, attempted Phase B inclusion, missing files, and byte-for-byte output integrity. Fail the database CI job on any mismatch.

The generator invoked in CI is:

```sh
python3 scripts/build-forward-only-bundle.py \
  --out /tmp/depotflow-phase-a \
  --remote-history supabase/tests/fixtures/production_migration_history_20261018.json \
  --compare-ref FETCH_HEAD
```

**That ledger argument is the historic fixture, not a fresh live observation.** Before *any* production approval, an operator must repeat the ledger query read-only and confirm both its versions and names match, and validate the actual hosted schema, role grants, RLS and the precise staged files. The generator is not a deployment command; the phase files are **not** ready to copy into a connected Supabase migration directory.

## Rollout boundaries that stay blocked

No official business registration, new-depot activation, public signup, default-off stock/return/sale gates, customer data changes or legacy creation API revocations are enabled by Phase A rehearsal. The real hosted Auth Before User Created hook remains to be installed and verified under separate approval; a local GoTrue pass does not remove the hosted direct-signup bypass finding.

An operator-approved future deployment sequence is: **fresh live-ledger read-only confirmation → actual schema/grant checks and backup → reviewed Phase A compatible SQL → old-app smoke checks → coordinated Vercel app cutover → verified new RPC paths → independently authorized and versioned Phase B**. Rollback after Phase B requires a separate compatibility plan; do not assume redeploying the old UI will work.

**Approval status:** not requested or granted for live work. Draft PR #107 stays unmerged. All checks use existing public GitHub Actions runners; no extra paid infrastructure.
