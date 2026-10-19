# DepotFlow — hosted Auth signup and PostgreSQL 17 release acceptance

**19 October 2026. Status: NO-GO; instructions for isolated clone / authorized cutover, not permission to modify production.**

## What is implemented, and what is not

The draft migration `20261018112000_stage_auth_side_signup_hook.sql` creates:
- `private.depotflow_before_user_created(jsonb)`, a SECURITY DEFINER **Before User Created** Postgres Auth Hook, callable only by `supabase_auth_admin`;
- a private RLS-protected `business_auth_signup_gate` with `enabled=false`;
- rejection of unknown/invalid payload and a 403 `Account registration is not available.` response while disabled.

The app separately requires `DEPOTFLOW_AUTH_SIGNUP_POLICY_VERIFIED=true`, `DEPOTFLOW_PUBLIC_SIGNUP_ENABLED=true`, and an exact HTTPS `DEPOTFLOW_SIGNUP_REDIRECT_ORIGIN` before showing signup. These application flags **do not control** GoTrue's direct `/auth/v1/signup` API. In production the hook and gate table were **not installed** at the 19 October read-only audit. Supabase's actual managed Auth-hook configuration is also not accessible through the connected Supabase project tools. Therefore we cannot claim the hosted signup bypass is closed.

Supabase documentation: [Before User Created Hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook), [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks).

## Acceptance steps — isolated NON-production project ONLY

1. **Use a distinctly identified PostgreSQL 17 branch** with its own project ref, account pool and publishable key, created only after the quoted cost is approved. Supabase branches may start without production data and are not automatically proof of the real schema: compare schema fingerprints and recorded migration history before calling this a clone.
2. **Inspect the actual schema**: match table/column/constraint/function/index/policy/trigger fingerprints, owner privileges, live ledger invariants, and public API grants against fresh production read-only results. If an object is missing, fail closed; do not auto-`db push` or `migration repair`.
3. **Stage the Auth hook on this branch only.** Confirm the function and RLS table exist, the gate is OFF, `supabase_auth_admin` has USAGE on schema and EXECUTE on function, `anon` and `authenticated` do not.
4. In the staging Supabase dashboard, configure **Authentication → Hooks → Before User Created → Postgres Function**: `private.depotflow_before_user_created`. Enable the hook. SQL creation alone does NOT install it in GoTrue.
5. Keep new signups OFF until the hook is installed; once hook installed, enable *Auth signup capability in staging* if necessary to exercise its denial (an Auth-global 400 error alone does not prove the hook works). Keep the **private DB gate OFF**.
6. Set up a disposable mailbox **controlled by the tester**; never use a customer email. Run the direct Auth API probe below with an explicit non-production ref. It must get an **HTTP 403 with the exact Auth-hook message**; a 400/401 from Auth validation or an app UI 404 is NOT an acceptable pass. If the test accidentally creates a staging user, clean up via staging Auth UI and mark release NO-GO.
7. Temporarily enable the private hook gate *only on staging*, test the positive email-confirmation flow and an actual login, verify email confirmation is required (a new signup must not get an immediately usable session), rate limits/CAPTCHA requirements, and that registration cannot provision another depot or edit Walnik's records. Turn gate OFF and preserve log evidence afterward.
8. On production rollout **after separate review and schema validation**, deploy reviewed additive migration, configure hosted Auth hook, test with an explicitly approved controlled account, and verify direct GoTrue rejection while the DB gate is OFF. Only then set `DEPOTFLOW_AUTH_SIGNUP_POLICY_VERIFIED=true` alongside an approved availability window; never use that flag as proof of service protection.

### Direct GoTrue staging bypass test

```sh
# Only on a disposable staging Supabase project. This may create a test user
# if the hosted hook is missing or misconfigured. Do not run on production.
export DEPOTFLOW_STAGING_PROJECT_REF="<a different branch ref>"
export DEPOTFLOW_STAGING_SUPABASE_URL="https://<branch ref>.supabase.co"
export DEPOTFLOW_STAGING_SUPABASE_PUBLISHABLE_KEY="<staging publishable key>"
export DEPOTFLOW_STAGING_TEST_EMAIL="<controlled disposable test inbox>"
export DEPOTFLOW_STAGING_AUTH_PROBE_APPROVAL=I_ACCEPT_A_TEST_SIGNUP_ON_ISOLATED_STAGING
node scripts/probe-hosted-auth-signup.mjs
```

The script refuses production ref `coyivbklakhilpcqqrzg` and mismatched origins, sends a direct Auth API signup request, never logs the key/password, and requires the exact deny result. Pure safety regressions are run without any network call: `node --test scripts/probe-hosted-auth-signup.test.mjs`.

## PG17 real-schema clone tests — required before merge/activation

- Fresh PG17 version and fingerprint must match **actual** production objects, not merely a clean repository replay.
- Production already records 55 migrations under partially different timestamps. The manifest in `docs/m2-applied-sql-reconciliation-manifest-20261019.json` and archived original SQL are review evidence, not executable migration instructions.
- Before applying draft M2 changes, prove on clone that current real production receipts, sales, customer debt, product/stock counts and crate obligations remain intact through the migration and backfill; run 31 tenant FK checks.
- Test original-shop account, business A and business B with deliberately identical retry UUIDs, malicious cross-depot IDs, direct Data API INSERT attempts, revoked owners, split-tender receipts and returnable crates, across concurrent writes.
- Compare fingerprints and financial invariants **before and after** the exact upgrade; record database time, PostgreSQL version, operator, commands, schema drift and all CI artifacts.
- Production data must not be copied into public CI. Do not turn on grants, Auth gate or business activation merely because a clean PG16/PG17 synthetic CI suite passes.
- Any mismatch/failure is release NO-GO. No automatic migration repair, schema reset, or retroactive timestamp edits.

## Unresolved blockers

Hosted Auth hook/dashboard configuration and direct GoTrue E2E are **not yet verified**. Real-schema PostgreSQL 17 branch creation requires explicit user consent to Supabase's quoted **$0.01344/hour**, plus actual upgrade trial and financial-data reconciliation. Version history remains different even though all applied SQL was inventoried.
