# DepotFlow — hosted PG17 schema, grants and Auth security audit (19 October 2026)

**Read-only application-schema verification and one isolated user-requested production Auth security change. NOT a Phase A release approval.**

## Production scope and baseline

Connected project: `coyivbklakhilpcqqrzg`, PostgreSQL **17.6**. SQL catalog queries inspect metadata only; no live customers, payments, debts, receipts, emails or secrets were exported. The first 55 original production migrations remain intact. The separate default-closed Auth guard was recorded as migration **20261019132131**, bringing the recorded ledger to **56** entries. There is still **one** existing Auth account.

The current production catalog was fingerprinted using `supabase/tests/live_schema_fingerprint.sql` after the Auth upgrade; its **eight** application `public`/`private` groups match `docs/release-evidence/production-schema-fingerprint-20261019.json` exactly. The new fingerprint combines function code and routine owner/SECURITY DEFINER status with direct ACL, effective role EXECUTE and schema usage, avoiding a previously identified false-positive ACL comparison. This is a fingerprint of the **live database against its saved live baseline**, not a proof that the isolated test reconstruction matches every permission.

| Live application schema category | Object count |
| --- | ---: |
| Relations | 37 |
| Columns | 221 |
| Constraints | 194 |
| Indexes | 80 |
| Functions | 61 |
| Policies | 33 |
| Triggers in public/private | 15 |
| Column-grant entries | 473 |

All current ordinary `public` tables report row-level security ENABLED; the current original-shop read policy roster is 27 known owner policies. The original legacy customer/product `INSERT(id,...)` grants and crate-create RPC execute permission remain available while Phase A is not deployed. The three replacement original-create RPCs are not live; deploying application code depending on them first would break creation.

## Specific differences compared with the zero-dollar test schema

The isolated GitHub Actions PG17 reconstruction starts with **55 historical SQL migrations** plus minimal emulation of managed Supabase platform schemas. Comparing exact per-object digests against the actual 56-stage hosted schema showed:

- **Function signatures:** 59 in the 55-stage historical recreation versus **61** live (the two new, expected Auth hook and insert-guard functions).
- **Two shared function definition hashes differ:** `public.rls_auto_enable()` (managed Supabase automatic RLS, represented as a minimalist CI stub), and `private.record_payment(uuid,uuid,numeric,date)` (historical formatting/comment normalization accounts for the known source-text discrepancy, but this alone is *not* semantic equivalence).
- **Column-grant differences:** both environments report 29 grant-bearing application tables; **28 of those tables** have differing column-grant digests. Live has **473** grant entries versus **238** in the historical minimal-clone report. The staged 56+65 rehearsal passes its own invariants, but it has not independently established actual hosted role/column ACL parity.

### Distinguishing application DML grants from Supabase-managed references

A fresh hosted read-only SQL audit splits the **473** `information_schema.column_privileges` entries as:

| Grantee | Operation | Entries |
| --- | --- | ---: |
| authenticated | SELECT | 201 |
| authenticated | INSERT | 18 |
| authenticated | UPDATE | 19 |
| anon | REFERENCES | 18 |
| authenticated | REFERENCES | 18 |
| service_role | REFERENCES | 199 |

Therefore **238 hosted client DML entries + 235 managed-style REFERENCES entries = 473**. The minimal historical PG17 reconstruction reported **238** entries total. This numerical alignment alone is **not proof of per-column ACL parity**, so `supabase/tests/fixtures/app_client_column_dml_acl.sql` now hashes the exact **29** grant-bearing table/column/client DML privilege inventories, and `docs/release-evidence/production-app-client-column-dml-acl-20261019.json` records the independently collected hosted hashes. The free PG17 workflow checks every reconstructed table hash and the counts before passing. **This exact client DML check PASSED on disposable PG17 CI [run #39264641457](https://github.com/NicoCipher/DepotFlow/actions/runs/39264641457): all 29 per-table hashes and role/operation counts match live.** No grant was added or revoked to make this match.

Even after the client DML match is verified, managed `REFERENCES`, `auth`/`storage` schemas, function ownership and GoTrue hook configuration remain separate parity questions; the source reconstruction is not a certified full Supabase schema clone.

**Decision:** the historical recreation's **application-client column DML privilege parity is now proven for all 29 grant-bearing tables**, but *full managed hosted schema/role/grant parity remains NOT proven*. Do not treat green PG17 CI as license to push Phase A. Obtain a securely handled actual production schema/role/ACL snapshot or a confidential real-schema isolated PG17 reconstruction, verify runtime role inheritance/managed grants, then apply the exact forward-versioned 65-stage Phase A candidate and compare pre/post business invariants. Do not grant client roles broadly just to make a synthetic clone match.

## Hosted Auth database status

The user-directed Auth-only migration installed:
- `private.business_auth_signup_gate` — exactly one row, `enabled=false`.
- `private.depotflow_before_user_created(jsonb)` — owned by postgres, `supabase_auth_admin` EXECUTE, no `anon`/`authenticated` EXECUTE. Evaluating a synthetic payload produces `error.http_code=403`.
- `private.depotflow_auth_user_insert_guard()` and an active `BEFORE INSERT` trigger on `auth.users`; the gate is checked inside the insert transaction. Existing account count remained one.

The database-level insert guard closes ordinary new-user insertion when signup is OFF, including staff invitations or privileged Auth creation through GoTrue. **Do not disable this guard or enable the gate during rollout.** Existing account login does not normally insert a new Auth account, but real live login has not been re-tested.

**Still unresolved:** The managed hosted GoTrue **Authentication → Hooks → Before User Created** configuration is not inspectable or changeable using the currently connected Supabase tools. The dashboard must be configured to call `private.depotflow_before_user_created`, keeping new signup disabled. An approved controlled hosted `/auth/v1/signup` request (expected denied, unchanged account count) and a real existing-user login must be verified before the hosted bypass review thread can close.

## Security advisor baseline

The hosted security advisor currently reports: four INFO RLS-enabled/no-policy private tables (including intended default-deny patterns), one anonymous SECURITY DEFINER `public.verify_receipt` function (public receipt lookup requires a separate intentional-exposure review), 15 authenticated SECURITY DEFINER routines requiring the owner/tenant-guard review, and one leaked-password-protection warning. These are advisor observations, **not proof of a newly introduced exploit**; do not automatically revoke needed receipt and sale RPCs.

Remediation references:
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Release state

Phase A proposal: **65** forward-only migrations after recorded `20261019132131`, not including already-deployed Auth source. Phase B: one independently gated old-create API revocation only *after* the new Vercel app uses replacements. PR #107 stays Draft/unmerged. No tenant SQL, Walnik business ledger writes, Vercel deploy or new-business activation occurred. No new paid Supabase branch/project was created.
