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

## Important limits — release is still blocked
- The production-hosted Supabase Auth service is **not known to have the hook installed/enabled**. At last read-only check, the hook function and gate were absent from production. The exact **production** direct-signup bypass issue is **still OPEN**.
- This does not test hosted email delivery, CAPTCHA, hosted signup rate limits, OAuth, or real application multi-business onboarding. It only verifies email/password signup via the direct local GoTrue API.
- The production migration history requires separate release planning. Do **not** merge PR #107 or activate the signup gate solely because local E2E passed.
- The user specifically requested **$0**. No paid Supabase branch/project has been created.

## Next action, without charge
Keep testing additional local attack cases (disabled gate, malformed request, revoked hook execution, registration transitions) and obtain Codex review. A controlled hosted rollout is a **separate explicitly approved production change**: review applied SQL, install the Before User Created hook and gate, confirm email confirmation settings, configure Auth Hooks in the hosted Supabase dashboard, and perform an approved direct hosted signup probe **while the DB gate is OFF** before enabling any onboarding.

**Never** point the local integration test at `coyivbklakhilpcqqrzg` (hardcoded production project ref).
