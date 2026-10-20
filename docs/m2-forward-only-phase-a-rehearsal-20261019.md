# DepotFlow — forward-only Phase A after hosted Auth hardening (19 October 2026)

**DRAFT. STAGING REHEARSAL ONLY. NO TENANT DEPLOYMENT APPROVAL.**

## Verified hosted starting point

On 19 October 2026 the connected, existing production Supabase project was checked using SELECT-only PostgreSQL catalog queries: PostgreSQL 17.6, one existing Auth user, 55 historical migrations, and no unexpected Auth trigger. The isolated, default-OFF Auth gate migration was then applied separately and verified as live migration **`20261019132131_depotflow_hosted_auth_signup_closed_guard_20261019`**. Production now has **56 applied migration versions**.

The Auth-only migration added `private.business_auth_signup_gate` (one row, `enabled=false`), `private.depotflow_before_user_created(jsonb)`, and an active `BEFORE INSERT` guard on `auth.users`. The hook function returned HTTP 403 in a direct SQL call, `anon` and `authenticated` lack EXECUTE, and `supabase_auth_admin` has EXECUTE. Existing `auth.users` count remained 1. These prove the database objects and deny decision, **not** hosted managed GoTrue hook configuration, direct live `/signup` behavior, or actual existing-user login.

The original 55-stage applied SQL evidence remains in `docs/m2-applied-sql-reconciliation-manifest-20261019.json`; the new, dated **56-stage live ledger including exact names** is `supabase/tests/fixtures/production_migration_history_20261019_after_auth.json`. Do not rewrite history or apply the old 55-version release package. The Auth migration MUST NOT be executed again in Phase A.

## Canonical next SQL bundle

The first candidate for the new **database-only Phase A** contains **65 untouched source SQL bodies**, with versions `20261019140000` through `20261019140104` strictly after the hosted 56th migration. `docs/m2-forward-only-release-inventory-20261019.json` and `supabase/tests/fixtures/m2_forward_only_sources_20261019.json` must match exactly.

`scripts/build-forward-only-bundle.py` emits Phase A only, using the same version/source order as `scripts/build-forward-only-m2-release.py` (which additionally emits the isolated Phase B test artifact). Both are **rehearsal-only** and must refuse unknown changes to the 56 live version/name ledger, tampered SQL evidence, extra SQL files, duplicate versions or re-including the already-applied Auth source.

The separately approved **Phase B** is just `20261018124000_finalize_legacy_creation_api_cutover.sql`, assigned a *new*, post-Phase-A version only in the disposable test bundle: `20261019140105`. It must never be delivered as part of an unattended database-first installation. It is individually gated by a durable operator authorization plus fresh transaction-local consent and preserves the old application's customer/product/crate create rights until explicitly finalized.

## Exact no-cost rehearsal

The disposable GitHub Actions PostgreSQL 17 process reconstructs the 55 historical SQL sources on a fresh sandbox; applies the *already-installed* Auth migration as simulated stage 56; then applies exactly the remaining 65 forward-versioned SQL bodies in staged order, preserving a synthetic legacy sale, debt, receipt, crate/bottle and stock ledger fingerprint. It separately exercises legacy customer/crate/product creation and refuses unapproved Phase B. It never connects to hosted production or uses live user/business data.

This is NOT a full production-schema clone. The historical PG17 fixture has differences in some managed Supabase function definitions and **column-level grants** (the previous 55-stage reconstruction had 238 visible grants vs 473 hosted production entries). Do not add broad grants merely to turn the check green.

## Fresh permissions-aware hosted schema fingerprint

`supabase/tests/live_schema_fingerprint.sql` now includes owners, direct ACL, effective routine EXECUTE for `anon`, `authenticated`, `service_role`, `supabase_auth_admin`, and schema usage alongside function definitions. The post-Auth live snapshot is in `docs/release-evidence/production-schema-fingerprint-20261019.json`. This closes a *blind spot in the comparison query*, not the actual managed-role parity gap. For a real clone, all eight groups must agree on the same SQL query, same PostgreSQL major and independently collected metadata.

## Remaining NO-GO steps

1. Independently verify hosted **Authentication → Hooks → Before User Created** actually calls `private.depotflow_before_user_created`. Existing Supabase connector cannot read or change that managed Auth setting. The active Auth insert guard is a database backstop, not proof the managed hook is configured. Public signup and new-business gates remain OFF.
2. After a separately authorized controlled live probe, prove `/auth/v1/signup` is denied without creating an account, verify an existing-user login and email confirmation configuration, and retain sanitized evidence.
3. Obtain a fresh 56-version read-only migration ledger immediately before release; compare actual database roles, RLS, schema, permission grants and real Walnik ledger invariants against an isolated actual-schema clone. Schema-only parity still remains unproven.
4. Obtain explicit approval for a separate tenant Phase A production release, verify old-app creates, cut over the application only after its replacement RPCs are present, then independently authorize Phase B. **No PR #107 merge, Vercel deployment, signup opening or second business activation yet.**

The Auth database security migration above is the only hosted DDL performed during this round. Its normal Supabase service usage remains within the existing project; no additional paid branch or infrastructure was created.
