# DepotFlow — $0 hosted Auth cutover checklist (NOT YET AUTHORIZED)

## 19 October live hosted Auth implementation update

**Auth-only DATABASE component applied to the existing hosted project under the user's current direction; provider-managed hook configuration NOT VERIFIED.** Supabase migration `20261019132131_depotflow_hosted_auth_signup_closed_guard_20261019` recorded as the 56th migration. Preflight: 1 existing Auth account, no non-internal `auth.users` trigger, no gate, no hook. Postflight: same 1 account, exactly 1 `private.business_auth_signup_gate` row with `enabled=false`, `private.depotflow_before_user_created(jsonb)` executable by `supabase_auth_admin` only (not `anon`/`authenticated`), active `BEFORE INSERT` guard, and hook test payload returns a JSON `error.http_code=403`. SQL was the existing tested `20261018112000_stage_auth_side_signup_hook.sql`, not a full M2 rollout. There is no evidence that the managed hosted Before User Created hook or confirm-email settings have been changed. No real hosted direct-signup probe or existing-account login was performed, so leave signup-bypass P2 OPEN. **Do not reapply the installed Auth SQL; the tenant release now starts from 56-version current ledger** documented in `docs/m2-forward-only-phase-a-rehearsal-20261019.md`.


**Prepared 19 October 2026** for Draft [PR #107](https://github.com/NicoCipher/DepotFlow/pull/107). Production project: `coyivbklakhilpcqqrzg`. First business: **Walnik Ventures**. No paid branch and no production modification is authorized by this document.

## 1. Real production preflight — completed, SELECT only

Run `supabase/tests/hosted_auth_production_inventory.sql` again immediately before any approved DDL. It has already been executed read-only against the live project, and returned:

- PostgreSQL major version **17**.
- `auth.users` owned by `supabase_auth_admin`; this role exists.
- At baseline there is **one existing Auth account**. Preserve existing `auth.users`, `auth.identities`, passwords, refresh tokens and sessions. Do not put customer emails/IDs in the repo.
- **No non-internal triggers** on `auth.users` at baseline.
- `private.business_auth_signup_gate`, `private.depotflow_before_user_created(jsonb)`, `private.depotflow_auth_user_insert_guard()`, and the insert trigger are **not present**.
- The database query **cannot see whether GoTrue has a managed Auth hook configured**, and cannot inspect the hosted project's signup/confirmation settings.

**NO-GO** if account count, Auth schema ownership, triggers, function signatures or grants unexpectedly differ from the baseline. A different count can reflect legitimate user activity: investigate the delta; never delete or overwrite an account to make the count match.

## 2. Manual hosted-provider and migration gates — NOT completed

Use the existing Supabase dashboard; do not create a branch or any paid project. Before touching production SQL, an authorized operator must inspect and privately record:

- Authentication → Providers: email provider enabled, **Confirm email ON**, **Allow new users to sign up** current setting, and any OTP/OAuth/anonymous providers. Record the exact screenshots with secrets and account data redacted.
- Authentication → Hooks: any preexisting **Before User Created** hook and its target. Never overwrite an unrelated installed hook without a separate migration/compatibility plan.
- Current registered user count, existing-user sign-in path and at least one tested, authorized login. No account deletion, password reset or import.
- The complete `auth.users` trigger list and permissions, and a **reconciled migration execution path**. The 55 live migration versions have source evidence, but the repository has different historical timestamps. **Do not run blind `supabase db push`, `db reset`, migration repair or a full 204-file PR rollout.**
- Reconfirm that the reviewed SQL still matches `supabase/migrations/20261018112000_stage_auth_side_signup_hook.sql` and its $0 local GoTrue / PG17 test logs. Other Auth user creation methods (invites, admin create, OAuth, SSO, anonymous sessions) can be affected by the insert guard; get explicit acceptance of this closed-registration behavior.

**Never use a copy of actual customer/user data in the public GitHub runner.** A schema-only capture/snapshot or a rollback-approved backup of protected production data must remain under the organization's authorized controls.

## 3. Explicit approval boundary — production changes NOT performed

Deploy the Auth-only component **only after separate explicit approval** for the exact live database changes and dashboard settings, under an operator-attended change window.

**Ordering is critical:**

1. Set DepotFlow's application registration flags OFF, then **disable new signups in hosted Supabase Auth** (not just the web app); verify that the Auth-side signup setting actually saved. Normal existing-user sign-in must remain possible.
2. Confirm the Auth service's signup switch is OFF; record `auth.users` aggregate baseline, DB role/grants, and absence or approved compatibility of existing hooks/triggers.
3. Through the reviewed, individually reconciled migration route, install ONLY the Auth gate, Before User Created function and `auth.users` insert guard from the staged SQL. The gate MUST default to **OFF**. Do not modify `auth.users` rows or enable any multi-business migration/activation flag.
4. Rerun `supabase/tests/hosted_auth_production_inventory.sql` (read-only). All expected objects must exist; `anon`/`authenticated` must not have EXECUTE on the hook or guard, `supabase_auth_admin` must be able to execute the hook. Inspect separately with `SELECT singleton, enabled FROM private.business_auth_signup_gate` and require exactly one `enabled=false` row.
5. In the hosted Supabase dashboard, configure Authentication → Hooks → Before User Created → Postgres Function, target `private.depotflow_before_user_created`. **SQL function existence alone does not install a managed GoTrue hook.**
6. Keep the private gate **OFF**. For an approved *single controlled direct API verification*, temporarily allow Auth-service signup only if necessary to distinguish a true hook-generated **HTTP 403** from the Auth service's unrelated global-disable response. The insertion guard must remain installed and OFF as a second backstop. The test must use an owned testing mailbox, a publishable/anon key (never a service-role key), and a tiny predefined request count. Afterward immediately disable Auth signup again. **If any test unexpectedly creates a new user/session, STOP: treat as an incident; do not enable onboarding.**
7. Verify existing account sign-in still works and `auth.users` count did not unexpectedly change; inspect managed Auth logs for any requests in flight. Do not disclose email addresses or session tokens publicly.
8. Explicitly **leave both app signup flags OFF and the private gate OFF**. Enabling Walnik staff or other depot onboarding is a *separate, later approved release* after main PR activation gates, receipt/debt/stock invariants and hosting rules are verified.

**Auth shutdown semantics:** GoTrue invokes Before User Created before its INSERT transaction. The inserted `BEFORE INSERT` guard holds `FOR SHARE` on the gate row during actual creation. A gate-OFF UPDATE must wait for accepted INSERT transactions; a timeout or error means **NOT CLOSED** and must be retried/investigated. Disable Auth signup service-side FIRST and audit recent user creations/sessions after closing. See `docs/m2-zero-dollar-auth-e2e-20261019.md`.

## 4. Stop and rollback rules

- **Stop immediately** if the baseline changed unexpectedly, hook/grant mismatch occurs, existing login fails, Auth management setting doesn't persist, unexpected users appear, the controlled probe returns a non-hook response, or migration history requires an unreviewed repair.
- With a partially completed rollout, keep hosted **new signups disabled**, app flags OFF and the gate OFF. Existing accounts should still log in; if they do not, investigate safely before any Auth schema rollback.
- Never disable/drop the insert guard while managed Auth signups can be accepted. Rollback must be a separately reviewed, operator-executed procedure with the Auth service signup switch disabled and protected backup available. Do not attempt database reset or delete users.
- No promise of a zero-downtime release: the new insert guard intentionally stops **new** Auth user creation while OFF (including invites/admin creates). Existing login uses Auth session/token endpoints and is independent of the INSERT guard.

## 5. Evidence required to close the original hosted Auth P2

1. Approved Auth-only production SQL change record and migration-version trace.
2. Two dated, sanitized pre/post SQL inventory outputs + verified private gate OFF.
3. Hosted dashboard Auth Hook target and email-confirmation setting confirmed, no unrelated hooks displaced.
4. Explicitly approved direct **hosted** `/auth/v1/signup` test: expected hook 403, no new user/session, followed by Auth signup disabling again.
5. Existing confirmed account login verified; history/security events audited.
6. Codex final review, PG17 CI, local GoTrue race test and app CI green on the actual release SHA.

Until all pass, keep PR #107 **Draft**, do not merge its tenant changes, and do not claim the production signup bypass is resolved.

**Cost:** this checklist, existing Supabase dashboard and connected read-only queries, and standard GitHub Actions for the public repository require **no additional paid Supabase branch**. Normal existing project limits/usage still apply.
