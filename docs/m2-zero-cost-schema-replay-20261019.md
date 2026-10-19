# DepotFlow — $0 PostgreSQL 17 production-history replay (19 October 2026)

**Status: verified history replay; production release remains NO-GO.**

## Why this exists

The Supabase organization already runs two active projects and creating its paid development branch would incur **$0.01344/hour**. The business owner explicitly declined that charge. No hosted branch, new project or paid resource was created.

DepotFlow is in a **public GitHub repository**, where standard GitHub-hosted `ubuntu-latest` runners are free. GitHub Actions can therefore run reproducible disposable PostgreSQL 17 checks without connecting to production or copying personal data.

Official background:
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://supabase.com/docs/guides/local-development

## Verified run

[Workflow run 39212291462](https://github.com/NicoCipher/DepotFlow/actions/runs/39212291462), branch `feat/m2f-tenant-inventory-read-barriers`, commit `ab8560017960f4696bbd995b2ce5368b45ac2f90`:

- Application and disposable PostgreSQL 17 suites **passed**.
- A separate fresh PostgreSQL 17 database `depotflow_history_replay` was created with **minimal Auth and Storage catalog fixture tables** only.
- `scripts/materialize-prod-history.py` verified the **55-item original production SQL evidence manifest**, 4 archived original statement hashes, and original live-version ordering.
- **All 55/55 historical migration SQL stages executed successfully** in recorded live order. This does not modify or repair production migration history.
- A read-only post-replay query `supabase/tests/live_schema_fingerprint.sql` was compared against the October 19 read-only live PG17 baseline.
- Of 8 public/private application schema fingerprint categories, **6 matched exactly**: relations, columns, constraints, indexes, policies and triggers.
- Two categories did not byte-match: functions and column grants.

### Targeted per-object difference analysis

Using the same read-only hash inventory independently against live and disposable databases:

| Category | Live | Disposable | Difference |
| --- | ---: | ---: | --- |
| Application function signatures | 59 | 59 | Two definition hashes |
| Application column grants | 473 | 238 | 28 of 29 tables differ |
| Other application schema groups | 6 groups | 6 groups | All six equal |

The two function hashes were:
- `public.rls_auto_enable()`: Supabase's managed auto-RLS event-trigger function is deliberately represented in the *minimal* CI bootstrap by a no-op stub. This is not application SQL equivalence.
- `private.record_payment(uuid,uuid,numeric,date)`: direct read-only `pg_proc.prosrc` comparison to repository source showed the **same function-body text after removing line comments and formatting whitespace**. Source-definition byte hashes differ. This is not a license to skip semantic review.

The permissions gap is material: the real Supabase platform has many column grants (including `service_role` and `REFERENCES` privileges) that the minimal test bootstrap does not recreate. **Do not fix the test by granting broad app-client privileges; match the managed platform role and grant model on a real local Supabase stack or use a confidential schema-only export before release.**

### What has NOT been proven

1. This is a **SQL-history reconstruction**, not a full `pg_dump --schema-only` of production; the remaining permission drift prevents a full parity claim.
2. **No production data were cloned.** No actual financial ledger values, historical debts, receipts or customer records were tested through an upgrade.
3. **Hosted Supabase Auth service settings were not replicated.** The staged Before User Created hook is not installed/configured on hosted Auth. The direct `/auth/v1/signup` bypass finding remains open.
4. `auth`, `storage` and platform-managed grants are only *minimal fixtures* in the free test. Their correct behavior has not been certified.
5. The production SQL history still has different version numbers from local migration file names. A zero-cost replay passing **does not authorize** `supabase db push`, migration repair, business activation or merging Draft PR #107.

## How to repeat free of charge

Push a change to Draft PR #107; the existing `.github/workflows/verify-database.yml` runs on standard free GitHub Actions infrastructure. Its `Diagnose original production SQL history...` step replays all 55 scripts into a fresh sandbox, reports the schema categories that differ, and prints **digests only**, no SQL bodies or customer information.

The history replay is labeled diagnostic so its expected Supabase-platform fixture differences do **not** masquerade as an application test failure. Read the job summary and the explicit **NO-GO** warnings; the independently enforced migration-history preflight still blocks unsafe production deployment.

### Zero-cost next stage

A local Supabase CLI stack (using a free standard public-repository GitHub runner or a trusted machine) can provide a more realistic Auth/Storage/role fixture than raw PostgreSQL alone. To test the exact hosted Auth hook, independently verify that local GoTrue is configured for `private.depotflow_before_user_created(jsonb)` and send a direct signup request against **local only**. This still will not prove the hosted production Auth setting and must not be represented as a paid-branch clone.

**No paid project, charge, production write or live data copy was performed.**
