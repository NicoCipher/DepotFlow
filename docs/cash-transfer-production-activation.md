# Cash + Transfer: controlled production activation

## Release sequence

1. Confirm the current production deployment is READY, the split feature flag is still off, and PRs #121–127 are merged. Confirm no outstanding SQL review findings and green disposable PostgreSQL CI for this release.
2. Check production Supabase schema without changing data: immutable `sale_tender_legs`, active `sale_tender_complete_on_mixed_sale` and `reject_fenced_sale_request` triggers, `private.split_sale_request_fences`, `check_split_sale_request` with the same advisory lock and permanent fence, receipt verification including tender legs.
3. Check that `save_sale_split_tender` is still not executable by `authenticated` or `anon`. It must require `private.shop_owner` even after granting EXECUTE.
4. Apply the reviewed `20261016210000_activate_split_tender.sql` to Supabase via a tracked migration; production migration timestamps may differ from repository filenames. Check that only `authenticated` gained EXECUTE.
5. Set production Vercel `NEXT_PUBLIC_SPLIT_TENDER_ENABLED=true`, and **redeploy**. This is a build-time client/server flag. Verify the new production deployment is READY on the correct domain and commit.
6. With the real shop owner's informed consent, run a **genuine sale only** (not a fabricated test purchase): select Cash + Transfer, enter both amounts, review, confirm once, and verify the sale, receipt, stock and previous debt. This step necessarily affects the real ledger; do not simulate it on Walnik Ventures.
7. If a save is uncertain, use **Check Sale** with the original request. Never press Save again or change the ID until the system definitively fences and confirms the non-save. Check Sales/Records to rule out duplicates.
8. Verify receipt, public QR verification, shared PNG, the customer's account and old-debt receipt when applicable, and history/records totals. Confirm legacy one-method payment still works.

## Independent rollback switches

1. Vercel: set `NEXT_PUBLIC_SPLIT_TENDER_ENABLED=false`, redeploy, and confirm Cash + Transfer is no longer offered. A stale tab may still show the option until refreshed.
2. Supabase: via a **new tracked migration**, revoke `EXECUTE` on `public.save_sale_split_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)` from `authenticated`. Keep `check_split_sale_request` and `split_sale_request_fences` intact so uncertain requests can still be reconciled safely.
3. **Never** drop/tamper with historical tender legs or rewrite a committed sale. Do not disable the permanent fence.

## Acceptance gates

- The simulated `authenticated` owner test must pass *after* the grant migration is applied in disposable PostgreSQL.
- Wrong totals, zero leg, replay mutation, unauthorized caller and recovery-with-late-write must fail closed.
- Old debt and new sale balances must remain separate; exact Cash and Transfer values must appear on both internal and public receipts.
- A real sale receipt cannot be declared proven by CI alone.

## Production preflight read-only SQL

```sql
select
 to_regclass('public.sale_tender_legs') is not null as tender_ledger,
 to_regclass('private.split_sale_request_fences') is not null as late_save_fence,
 exists(select 1 from pg_trigger where tgname='reject_fenced_sale_request' and tgenabled<>'D') as fence_active,
 exists(select 1 from pg_trigger where tgname='sale_tender_complete_on_mixed_sale' and tgenabled<>'D') as tender_checks_active,
 (select has_function_privilege('authenticated',p.oid,'EXECUTE')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='save_sale_split_tender') as owner_role_rpc_permission,
 (select has_function_privilege('anon',p.oid,'EXECUTE')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='save_sale_split_tender') as anonymous_rpc_permission;
```
