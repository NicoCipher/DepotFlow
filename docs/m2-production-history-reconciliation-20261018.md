# DepotFlow M2 — production migration-history reconciliation (read-only)

Captured **18 October 2026** from the connected **DepotFlow** Supabase project, not inferred from Git history. This is an evidence and release-blocker record, **not permission to migrate or repair production**.

## Observed state

| Area | Result |
| --- | --- |
| Live applied migrations | **55** |
| Live tip | `20261017132742` (`activate_multi_tender_owner_only_20261017`) |
| PR branch local migration files at capture | **117** |
| Live versions with no equal local timestamp | **44** |
| Local versions not recorded live at or before live tip | **61** |
| Staged migrations after live tip | **45** |
| Live versions with exactly equal local timestamp | **11** |
| Additional candidate matches by exact filename suffix ONLY | **31** |
| No clear suffix/number candidate | **13** |
| Definitively proven historical SQL equivalent | **0** (not yet assessed) |

The live history source is `supabase/tests/fixtures/production_migration_history_20261018.json`. Every one of the 55 entries has a nonempty recorded SQL statement array in `supabase_migrations.schema_migrations` (read-only metadata check). The candidate-to-local map in `docs/m2-live-migration-candidate-map-20261018.json` is intentionally marked **UNVERIFIED** for every entry. Identical names are not proof of identical SQL: remote patches, split/merged migrations and out-of-order historical operations can differ significantly.

**No production migration-history rows were inserted, edited, deleted or repaired. No public schema, business data, policies or grants were changed in production.**

## Live application schema baseline (select-only, 18 Oct)

`supabase/tests/live_schema_fingerprint.sql` captured the following from `public` and `private` catalog definitions and applicable column grants:

| Kind | Objects | Definition MD5 |
| --- | ---: | --- |
| Relations | 36 | `6bc2954a26f61020fa8b22c1f3a6f873` |
| Columns | 219 | `335b68e5a198b9a2207c4b8fb851296d` |
| Constraints | 192 | `d32c4e914fd0f808e28a3cdce7337841` |
| Indexes | 79 | `12bdcd5193737a073c838fe6f119130c` |
| Functions | 59 | `d3f5235fae93ff13b176b5dd31c3d6b7` |
| Policies | 33 | `404e2276a7edff940b840cc7db2c74df` |
| Triggers | 15 | `8ac1ebaa4d97a8ae8258f169c36bbbb1` |
| Column grants | 473 | `533104141549e7e6d1659e61b93570b1` |

This is **not** a full database fingerprint; Auth, Storage, extensions, privileges beyond column grants, secrets and production data are excluded. The comparison must use the same query on a separately isolated database running compatible PostgreSQL 17 to investigate drift.

## Safe forward plan

1. **Keep the PR Draft and preserve strict preflight failure** for any historical mismatch. The newer 55-entry fixture replaces the obsolete 47-entry CI sample; GitHub SQL and app tests must remain green.
2. **Clone the current production schema into an isolated staging Supabase branch** (or independently restored local PG17 instance), with production data excluded. Supabase's branch creation has an hourly compute cost and requires explicit approval. Do NOT launch a paid branch until approved.
3. Run `live_schema_fingerprint.sql` on the isolated branch **before** PR migrations. Compare all eight output categories to the baseline above; differences require a per-object DDL investigation. Supabase branches built from migration history may differ from current production if manual SQL changes have drifted.
4. Compare **actual remote recorded SQL statements**, not names alone, with the repository candidate source. Produce a signed-off mapping/forward-only baseline that preserves existing live versions, handles 13 unmatched versions, and does not replay operations already applied. Never silently rename timestamps, force `db push --include-all`, or `migration repair`.
5. Rebase/repackage staged M2 changes above the **real** live tip into separately reviewed forward-only migrations. Dry-run against the clone with typed grants, owner revocation, actual structure and A/B adversarial transactions. Compare results and reverse/rollback procedure. Retest checkout/receipts on realistic synthetic data.
6. Only after history equivalence, clone schema parity, security review and all other release gates pass should a production migration plan be proposed. **Do not activate tenant gates or migrate Walnik live records now.**

## Caveats

The source of truth for both deployed migration versions and applied database structure is **production**, not the disposable PG16 green CI suite. Filename matching or PG16 green tests do not prove equivalence to the live PG17 structure. A schema-only Supabase branch may still have platform defaults differing from production; compare before concluding parity. Never copy real customer/financial data into unapproved development environments.
