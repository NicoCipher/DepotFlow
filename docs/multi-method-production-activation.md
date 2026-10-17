# Multi-method payments — controlled release

This extends the verified existing Cash + Transfer feature with Cash + POS,
Transfer + POS and Cash + Transfer + POS, and explicit per-method settlement
of earlier customer debt. **It must not silently relabel or alter historical money.**

## Current release gates

- Code: a new default-off `NEXT_PUBLIC_MULTI_TENDER_ENABLED` flag.
- SQL: `20261017132205_generalize_multi_tender_guarded_20261017.sql` updates the immutable
  method constraint and deferred financial checks; it adds
  `public.save_sale_multi_tender` without a default grant. A SECOND reviewed
  migration `20261017132742_activate_multi_tender_owner_only_20261017.sql` grants
  authenticated-only EXECUTE once all schema and recovery prerequisites pass.
- **Existing** `save_sale_split_tender` and `NEXT_PUBLIC_SPLIT_TENDER_ENABLED`
  remain intact. A partial rollout cannot disrupt verified Cash + Transfer.
- Production Supabase migration versions diverge from repo filename versions.
  Do not blindly run `db push`, `--include-all`, migration repair, or
  apply unrelated unmerged multi-business migrations. Use a verified clone
  and a new uniquely named, tracked production migration.

## Required approval sequence

1. Require green lint, domain tests, TypeScript, production build and full
   disposable PostgreSQL SQL/concurrency tests; obtain fresh Codex review
   against the final PR commit. Test on a **separate non-production business**.
2. Perform read-only preflight against intended production Supabase project:
   verify the new method-check constraint can extend without rewriting rows,
   immutable trigger and split request fence are enabled, existing Cash +
   Transfer saver still works, and receipt verification exposes only
   token-authorized method amounts. Inspect exact migration history.
3. Confirm the already-applied schema extension and its **tracked production migration**. Verify
   `sale_tender_legs.method` now allows `pos`, the mixed-sale deferred
   trigger permits exactly 2–3 real methods, and
   `has_function_privilege('authenticated',...,'EXECUTE')` remains false
   for the new saver before the separate activation migration. A schema deployment alone does not
   enable the new UI or direct API.
4. After inspecting SQL release conditions, apply the separately reviewed
   `20261017132742_activate_multi_tender_owner_only_20261017.sql` migration to grant only `authenticated` EXECUTE on
   `public.save_sale_multi_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)`.
   Anonymous and PUBLIC must stay denied. Explicit owner authorization is
   checked *inside* the SECURITY DEFINER procedure. Revalidate via read-only
   metadata and a disposable authenticated caller fixture, not a fake sale
   against the real Walnik Ventures records.
5. Set Vercel production `NEXT_PUBLIC_MULTI_TENDER_ENABLED=true`, preserving
   the existing `NEXT_PUBLIC_SPLIT_TENDER_ENABLED=true`; redeploy and verify
   the intended domain/commit is READY. This new flag is read at build time
   on both the checkout UI and save Server Action.
6. With the owner's informed consent, record a **genuine** transaction using
   POS + another method. Check same saved request ID, actual tender leg rows,
   total and old-debt allocations, sale receipt, old-debt receipt (when
   applicable), shared PNG, public QR verification, stock and customer record.
   Repeat on a genuine three-method payment when one occurs. Do not create
   fictional real-business money or stock entries for test purposes.

## Recovery, compatibility and rollback

- No save uncertain outcome is treated as absent until Check Sale obtains
  the original advisory lock and permanently fences a missing request ID.
  Never press Save twice or assign a fresh request ID while outcome is unknown.
- Drafts stored using the older Cash + Transfer fields still use the original
  saver; switching them to Multiple methods is explicit and preserves actual
  amounts. Original mixed ledger rows and receipts remain immutable.
- To disable NEW combinations: set `NEXT_PUBLIC_MULTI_TENDER_ENABLED=false`
  and redeploy. **Keep the old Cash + Transfer flag on.** Refreshing a stale
  tab may be needed. The checkout must preserve any unfinished multi-method
  draft and provide Check Sale for an uncertain save.
- For emergency database revocation, make a NEW reviewed migration that
  revokes EXECUTE from authenticated for `save_sale_multi_tender`. Keep the
  request-ID fence and reconciliation RPC operational; never delete tender
  legs, undo paid debt, or rewrite committed receipts.
- If schema/rules are incompatible, **stop** before applying production SQL;
  do not repair version history by hand or bypass a failed preflight.

## Status checklist (17 October 2026)

- Schema extension deployed and read-only verified; two existing tender legs preserved.
- Repo schema migration filename aligned with production-assigned version `20261017132205` in PR #138.
- Authentication activation migration is tracked and disposable-PostgreSQL tested in a separate PR; not a signal that live checkout has been exercised.
- Vercel `NEXT_PUBLIC_MULTI_TENDER_ENABLED` must stay OFF until the grant and deployment are separately verified.
