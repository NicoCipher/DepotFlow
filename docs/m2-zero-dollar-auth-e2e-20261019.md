# DepotFlow: zero-dollar real local Supabase Auth security verification
**Date:** 2026-10-19  
**Release status:** Draft PR #107 — **hosted Auth signup still NOT verified / NO-GO**

## Evidence
- Free GitHub-hosted runner workflow: [Verify local Auth signup (free), run 39214322446](https://github.com/NicoCipher/DepotFlow/actions/runs/39214322446) — **SUCCESS**.
- Pinned Supabase CLI: `2.119.0`.
- Disposable Supabase CLI project defined by `supabase/tests/auth-local/config.toml`.
- No hosted Supabase project ref or API key, no production data, no Supabase branching charges.
- The workflow copies **the exact staged SQL migration** `supabase/migrations/20261018112000_stage_auth_side_signup_hook.sql` into a disposable CLI project after creating a private schema.
- Real local GoTrue Postgres Before User Created hook: `pg-functions://postgres/private/depotflow_before_user_created`.
- Test runner: `scripts/test-local-gotrue-signup.mjs`, hard-pinned to `127.0.0.1:54321` (Auth) and `127.0.0.1:54322` (PostgreSQL). No other origin can be selected by environment variables.

## Assertions verified against real GoTrue and PostgreSQL
1. **DB gate OFF:** direct `POST /auth/v1/signup` returns HTTP **403** with `Account registration is not available.`; the attempted email is absent from `auth.users`. This proves that UI bypass is blocked in the **configured local stack**, rather than only calling the hook as a SQL function.
2. **DB gate ON:** direct signup responds successfully and inserts **exactly one** user in `auth.users`. Email confirmations remain required; `email_confirmed_at IS NULL`, no session or access token is returned, and password login before confirmation is denied.
3. **DB gate OFF again:** direct signup is again rejected with **403**, no third user appears, and the previously registered but unconfirmed user remains.
4. **Privilege boundaries:** `supabase_auth_admin` has function `EXECUTE`, `anon` and `authenticated` do not, and the gate begins disabled.
5. **Cleanup:** CLI stack is stopped and erased with `supabase stop --no-backup`, even on test failure.

The first attempt, run `39214002627`, passed the denial assertion and then failed due to a **test parser mistake**: the raw GoTrue REST API returns the user at the response root, whereas `supabase-js` wraps it under `data.user`. That was corrected; the second run passed all three scenarios without weakening the hook.

## 19 October follow-up — deterministic shutdown race verified

[Local Supabase Auth E2E run 39216683756](https://github.com/NicoCipher/DepotFlow/actions/runs/39216683756) **passed** with a tested second safety check inside the actual `auth.users` insert transaction.

**Why the change is necessary:** Supabase GoTrue invokes the Before User Created hook **before** its eventual user-creation transaction. A standalone hook response of allow cannot prevent that insert committing after a later gate-off update. A sequential OFF→ON→OFF test by itself cannot prove instant closure.

**Protection staged, not deployed:** the same staged migration now creates a `BEFORE INSERT ON auth.users` trigger using `private.depotflow_auth_user_insert_guard()`. For the dedicated GoTrue database session, it rechecks the private gate with `SELECT ... FOR SHARE` inside the actual user insertion transaction. That lock lasts until the insert transaction commits or rolls back. Thus a concurrent gate-OFF update must wait for a previously authorized insert to finish; if gate-OFF committed first, the late insert is rejected. The function fails closed if the private gate is missing or disabled. Privileged `postgres` migration/fixture sessions are explicitly exempt; only trusted operators with database superuser access can use that path.

**Two real concurrency tests** use temporary pause triggers in the disposable CLI stack only (they are dropped after each test):

- *Pre-insert race:* the earlier hook accepts a request while gate ON; an isolated test trigger pauses its eventual insert; the gate is switched OFF, then the insert resumes. **User creation fails and no account appears.**
- *Insert-already-started race:* a test trigger pauses a legitimate insertion after the transaction's row lock was acquired. An attempted gate-close update fails on its short lock timeout, rather than falsely reporting success. After the pending signup finishes, gate-close succeeds; later direct signup returns hook **403**.

These tests check a real GoTrue service and `auth.users`, not a mock. A gate-close operation that times out or errors **must be treated as NOT CLOSED**, inspected and retried.

**Safe hosted shutdown sequence (requires separate authorized rollout):** disable registration in managed Supabase Auth settings first (not only the DepotFlow UI flag); set the private gate OFF, allowing any already-inserting transactions to drain through row-lock serialization; require the UPDATE to commit and query back `enabled=false`; audit recent created Auth users and sessions; verify new direct signup requests are rejected; then report registration closed. When gate OFF, the trigger also blocks normal GoTrue/admin user creation/invitations, so do not use it for emergency onboarding unless a separately reviewed process temporarily re-enables registration. Authentication of existing users is not blocked by the INSERT-only trigger.

**Caveats:** before production use, review any other managed `auth.users` triggers and all hosted Auth providers/flows, and retest after Supabase/Auth upgrades. Local concurrency coverage does **not** establish that production's managed Auth Hooks settings or schema have been updated. Do **not** activate this mechanism or merge PR #107 on the basis of a local test alone.

## Important limits — release is still blocked
- The production-hosted Supabase Auth service is **not known to have the hook installed/enabled**. At last read-only check, the hook function and gate were absent from production. The exact **production** direct-signup bypass issue is **still OPEN**.
- This does not test hosted email delivery, CAPTCHA, hosted signup rate limits, OAuth, or real application multi-business onboarding. It only verifies email/password signup via the direct local GoTrue API.
- The production migration history requires separate release planning. Do **not** merge PR #107 or activate the signup gate solely because local E2E passed.
- The user specifically requested **$0**. No paid Supabase branch/project has been created.

## Next action, without charge
Keep testing additional local attack cases (disabled gate, malformed request, revoked hook execution, registration transitions) and obtain Codex review. A controlled hosted rollout is a **separate explicitly approved production change**: review applied SQL, install the Before User Created hook and gate, confirm email confirmation settings, configure Auth Hooks in the hosted Supabase dashboard, and perform an approved direct hosted signup probe **while the DB gate is OFF** before enabling any onboarding.

**Never** point the local integration test at `coyivbklakhilpcqqrzg` (hardcoded production project ref).
