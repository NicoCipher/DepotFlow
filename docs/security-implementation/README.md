# M1 implementation draft — business identity, owner-only membership

These SQL files are **reviewable implementation drafts**, not executable repository migrations. They are deliberately outside `supabase/migrations/`, so standard database CI and production will not apply them automatically.

The Supabase CLI is not currently available in this execution environment. Before shipping, use the CLI's `supabase migration new <name>` command to create correctly named migration files, migrate the reviewed SQL into them, then run the project's complete disposable Postgres test suite. Never claim a draft or a passing review equals a production-tested migration.

## Files in intended order

1. `m1-business-memberships-schema.draft.sql` — add `private.businesses` and `private.business_memberships`, RLS enabled, no direct `authenticated`/`anon` privileges, staff membership defaults **disabled**.
2. `m1-owner-backfill.draft.sql` — **separate admin-only** controlled seed of one business and one legacy-owner membership. Requires exactly one existing registered `private.shop_owner` with matching Auth identity, is transactional and replay-safe, and never silently reactivates an altered membership.
3. `m1-owner-membership-smoke.draft.sql` — test after seeding on disposable DB; legacy owner authentication still works, private tables have no direct client grants, self-enrolment and data reads are rejected.

## Migration and release gates

- Do not use the owner backfill in a **fresh test database before its owner fixture is installed**. The normal migration stage may have zero configured owners; install the schema first, then test the backfill against an initialized disposable owner fixture.
- Confirm the production database still has exactly one owner before proposing the seed. Never copy user IDs, passwords or secrets into migrations or review comments.
- After migration generation, verify all existing app migrations and tests on the same Postgres version as project CI. Add explicit tests for backfill retry, wrong owner state, unprivileged membership insert/update, and no business-table policy exposure.
- Test production-equivalent schema with two synthetic businesses in an isolated database. M1 **does not** enable multi-tenant data access or prove that operational tables are isolated.
- Install schema and seed as **separate, reviewed** rollout steps. Confirm business and membership counts, no direct API exposure, `is_shop_owner()` behavior, and unchanged stock/debt/receipt record totals.
- Do not add a staff login UI, invitations, a business picker, or any grant broadening as part of M1.
- Backward-compatible additive structure only; preserve current `private.shop_owner` and its policies exactly.
- Keep Vercel previews disabled. A docs/draft PR is not a reason to trigger production.

Next: security review this draft; generate official migrations via Supabase CLI; run disposable PG tests; gate on final owner approval before touching production.
