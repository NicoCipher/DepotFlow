# Manual DepotFlow Phase A database release

This is a **standalone, manual-only** GitHub workflow for finishing the database-first migration sequence without merging DepotFlow PR #107. The workflow must be placed on **main** to appear under GitHub Actions. Neither app code nor Supabase migrations are executed merely by merging this workflow.

**Locked source:** PR #107 SHA \`7181bae6585f98473f878bd798fae81f73b4f5db\`.
**Live checkpoint:** 56 original + 12 applied Phase A = **68**, next migration \`20261019140012_legacy_customer_reader_scope\`.
**Target:** 121 migration entries, preserving the Auth account, legacy owner/business membership, closed signup and 45-drink shared catalogue.
**Explicitly excluded:** Phase B, manual migration repair, blind \`supabase db push\`, app merge, and enabling public signup/new tenant writes.

## Setup from a phone

1. Review and merge **only the standalone workflow PR** to \`main\`. Do not merge PR #107 yet.
2. GitHub repo → **Settings → Environments → New environment** → \`depotflow-production-database\`. Set required reviewers if available; avoid enabling "prevent self-review" when you are the only reviewer.
3. Within that environment create one secret named \`DEPOTFLOW_PRODUCTION_DATABASE_URL\`. Copy the **Session pooler** Postgres URI for existing Supabase project \`coyivbklakhilpcqqrzg\` from Supabase → Connect. Ensure it uses port 5432 and \`sslmode=require\` in the URI. Paste the **actual database password** into the URI; do not share it in chat, a public file or a repository variable.
4. In GitHub → **Actions → DepotFlow — manual Phase A database → Run workflow**, select **main**, choose \`preflight\`, run and approve the GitHub environment job. This mode never writes to the database.
5. If preflight succeeds, manually run the same workflow with mode \`deploy\` and exact phrase \`DEPLOY_53_PHASE_A_MIGRATIONS\`, and approve the environment job. It applies only the unrecorded canonical migration suffix in strict order.
6. After success, independently verify **121** migration entries, application compatibility, hosted Auth access controls, and checkout/returns before merging PR #107.

## Guardrails and limitations

- The trusted deployment runner lives on \`main\`; the PR source is **checkout by fixed commit SHA** and is never executed as Python/Node code with the database secret. Only its locked SQL stages are read.
- Uses a \`PGDATABASE\` **secret** rather than a credential in source or logs. Fails closed on an unexpected Supabase project, TLS mode, migration/version/name, owner/account, signup status, catalogue count or new business records.
- Stage SQL and its corresponding migration-history insert run **in the same Postgres transaction**. On failure the runner stops, never skips stages, never rewrites history, and never retries in a loop. Manual restart verifies the entire real ledger first.
- The existing database data were explicitly test-only and cleared by the owner. This is **not** a backup, full managed-Supabase-clone proof, or authorization to merge the app. The prior live Auth signup endpoint test remains deferred.
- If a platform safety control rejects execution, stop and investigate rather than bypassing the restriction.
- GitHub Actions on a public repository does not require a paid Supabase branch. Project usage stays subject to the existing Free limits.
