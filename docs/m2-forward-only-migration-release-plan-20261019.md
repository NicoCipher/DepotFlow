# DepotFlow — forward-only M2 release packaging (19 October 2026)

**STATUS: DRY-RUN PACKAGE ONLY; NO PRODUCTION AUTHORIZATION.**
This document concerns the draft [PR #107](https://github.com/NicoCipher/DepotFlow/pull/107), not a production rollout. Keep all public-signup/new-business gates **OFF** and PR **Draft**. No files under the existing `supabase/migrations/` are renamed, repaired, or executed against production.

## The actual mismatch

The **read-only** 18 October production-ledger snapshot contains **55 applied versions**, ending at `20261017132742`. The 19 October applied-SQL evidence lists **29 byte-exact matches, 22 lexical-only comparisons, and four archived originals**. These matches do **not** mean the historical local migration filenames/versions equal what the hosted Supabase migration ledger recorded. An ordinary `supabase db push` from this repository would encounter obsolete filenames and cannot be used safely as the release mechanism.

Separately, PR #107 adds **67 distinct SQL files** (old filenames range from 16–18 October). They cannot be applied as unreviewed timestamp-older history.

## What the generator now does — no external infrastructure

`scripts/build-forward-only-m2-release.py` uses the recorded ledger and the explicit **67-source allowlist** `supabase/tests/fixtures/m2_forward_only_sources_20261019.json`. It rejects absent/duplicate/unknown migration versions, source list drift, and **any difference** from the 55-entry recorded ledger. Its only permitted output is a fresh directory **outside** the repository; it never calls Supabase, writes to a database, edits applied-history records, or deploys anything.

The candidate forward-only versions begin at `20261019120000` and end at `20261019120106`. They correspond exactly, in order, to the 67 source bodies, with SHA-256 hashes and a machine-readable output manifest. The version choice is **not reserved in production**: a fresh read-only ledger must be compared again before any deployment decision. If the live ledger advances, this package is automatically invalid; a new plan/review is required.

It deliberately creates two **separate directories**:
- `phase-a/`: **66 backwards-compatible staged database migrations**. Replacement customer/crate/product creation RPCs coexist with old production client permissions. Multi-business activation remains off. The staged Auth protection function does **not** by itself install the live GoTrue Before User Created hook.
- `phase-b/`: **one final permission-revocation migration**, explicitly refused unless the verified new application is live, a privileged operator has approved the default-off gate, and the same transaction presents fresh operator confirmation. It must never be combined into an unattended Phase A push.

**Disposable rehearsal commands (not a production runbook):**

```sh
python3 -m unittest discover -s supabase/tests -p 'test_forward_only_m2_release.py'
python3 scripts/build-forward-only-m2-release.py \
  --remote-history supabase/tests/fixtures/production_migration_history_20261018.json \
  --out-dir /tmp/depotflow-forward-only-rehearsal
```

The free PostgreSQL 17 workflow reconstructs the 55 applied SQL stages, seeds a synthetic original-shop sale/customer/debt/receipt/stock/empties ledger, **applies the generated Phase A files**, verifies old-client customer/crate/product creation still works, proves Phase B fails without consent, then simulates the separately approved Phase B **on the disposable database only**. Pre/post financial/physical ledger hashes must be identical. Existing adversarial tenant/owner and real local GoTrue tests still run.

## Remaining release gates — do not skip

1. Obtain a **fresh** read-only hosted migration-version list and production-schema fingerprint and compare with this snapshot, including policy/role/extension/grant differences. A recreated 55-stage PG17 database is **not** a copy of production's actual schema or customer data.
2. Review and approve a **clean isolated release directory** and an operator-attended forward-only migration-ledger recording method. Never let `supabase db push` see the repository's old historical filenames or the Phase B finalizer. Do not `--include-all`, reset linked production, or silently call `migration repair`. A version-number change alone does not reconcile the historical Supabase CLI state.
3. Verify the original Walnik Ventures owner account and private actual balances/stock/receipt/empty obligations with an operator-approved confidential backup and pre/post invariants. Never copy live customer data into public GitHub Actions.
4. Obtain separate explicit authorization before **any** production SQL, managed hosted Auth hook configuration, Vercel deploy, original-shop app cutover, or Phase B. New business signup and activation require their own release, after the original business is safe.

**Go/no-go today:** no live-history freshness proof, no actual-production-schema parity certificate, no hosted signup hook and no operator approval. PR #107 is still **NO-GO**, regardless of a successful local rehearsal.
