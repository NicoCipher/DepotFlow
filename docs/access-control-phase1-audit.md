# DepotFlow — Phase 1 access-control audit

Status: **baseline completed; architecture and role defaults proposed for review**. Date: 2026-10-14. Scope: repository `main` at `dcbb6d0` and read-only inspection of the connected production database. **This document does not enable staff, change roles, migrate data, or certify the application secure.** Sensitive security findings should be handled privately before publication; this document records controls and migration obligations, not exploit steps.

## Current system (verified)

- The server verifies a Supabase user through `auth.getUser()`, then calls `public.is_shop_owner()`: `src/lib/auth/owner.ts`, `src/app/sign-in/actions.ts`, `src/app/(shop)/layout.tsx`. Other server actions use `requireOwner`, `ownerSession`, or the protected owner-only database API.
- Ownership resides in the single-row `private.shop_owner` table. The app currently supports one registered operator/owner; it does not model business memberships or staff permissions.
- Production metadata: **26 public application tables have RLS enabled**; none of those 26 tables has a `business_id`/`shop_id` column. There are five private application tables and one public `security_invoker` view. There are **50 application functions** across public/private schemas; no current function implementation references a tenant `business_id` or `shop_id`.
- Production currently has **26 public RPC functions**, 11 of which are `SECURITY DEFINER` and callable by signed-in users. Their guard chains must be audited function-by-function in the migration; SQL security-definer and invoker wrappers are *not* equivalent.
- Production has five narrowly scoped authenticated **column-write grant groups**: insert/update for `customers` and `products`, plus update of `product_catalogue.image_path`. A table-level privileges check alone will miss column-level writes.
- The public `verify_receipt(uuid)` endpoint is deliberately callable by anonymous holders of a receipt verification token; it is an intentional exception requiring minimal response, token protection and rate-limit review.
- Supabase advisor results require triage, not blind fixes: warnings for public/authenticated `SECURITY DEFINER` RPCs, Auth leaked-password protection not enabled, and informational policy notices for internal tables. Review each guard and intended exposure before changing grants.
- Staff login, invitations, membership status, role editing, tenant selection, audit actor IDs, and staff revocation enforcement are **not implemented**.

## Critical implications

1. **P0 for multi-business launch — tenant isolation.** Single-owner RLS rules and privilege checks cannot become “any signed-in user” policies. Every sensitive row, RPC, trigger and foreign-key path must verify the active business and an active membership.
2. **P0 — prevent cross-business joins and writes.** Protect customers, sales, sale items, payments, product assortment, stock, empties, pricing, receipt snapshots and associated audit rows; enforce consistent business ownership of referenced IDs inside atomic database operations.
3. **P0 — preserve financial invariants.** `save_sale_with_old_debt_payment`, debt-payment operations, receiving, stock counts and empties processing must retain concurrency checks, nonnegative balances/stock, idempotent request IDs and immutable receipt history.
4. **P0 — session and permission freshness.** Every privileged write should check current active membership/permissions in PostgreSQL, not trust user-editable metadata, unrefreshed JWT role claims, hidden UI, or the last selected business in local storage. Revocation must block subsequent operations immediately.
5. **P1 — identity boundaries.** The person (`auth.users`), business, and business membership are separate objects. A person may have different permissions in two depots. The platform operator must not inherit every depot's owner privileges.
6. **P1 — privileged code and views.** Inventory and test the guard paths of all definer functions, authenticated RPC wrappers, direct column grants, and storage policies; review whether private helper execution grants can be narrowed.
7. **P1 — global vs tenant catalogue.** Shared master product definitions and verified images should remain explicitly platform-governed. Per-business assortment, prices, product pictures, and historical cost records need business isolation. Avoid using `owner_user_id` as a permanent surrogate for business ID.
8. **P1 — access recovery and fraud controls.** Enable compromised-password checks where supported, introduce owner MFA/recovery, audit sensitive actions and provide rapid staff removal without losing historical attribution.
9. **P2 — defense in depth.** Review internal private-schema table RLS policies and public receipt verification abuse controls; absence of direct client grants is not an excuse to skip further isolation checks.

**Additional pre-staff launch blockers from Codex review:**

- The current combined checkout uses `public.record_payment` internally; future `payments.collect_old_debt_standalone` must not be bypassable by a checkout-only user. Refactor to guarded, **separate public entry points sharing a non-public internal payment implementation**, protecting transactional integrity and the existing receipt numbering/idempotency.
- The existing customer action can waive mandatory empties deposits by updating `customers.empties_deposit_required`. Require distinct, auditable `empties.deposit_waive_customer`, not `customers.manage`; restrict direct column writes.
- **Actor fields are not a full mutation audit.** Staff-delegated changes to products, prices, customer records, deposit rules and employee permissions must produce immutable business-scoped actor, reason and safe before/after audit events by M2/M3, or the operation remains owner-only when staff access begins.


- Current `set_empty_crate_count` (like `set_current_stock`) applies variance immediately. A stockkeeper may **submit** a pending observed crate quantity with `empties.count_submit`, but may not **finalize** a variance without `empties.finalize_variance`. Both require independently tested RPCs.
- The combined sale RPC must check `sales.create` plus conditional `payments.collect_at_checkout` when `p_paid>0` and `payments.collect_old_debt_at_checkout` when `p_old_debt_paid>0`.
- Employee `records.view_own` requires trusted, immutable transaction actors persisted in M2/M3; pre-existing transactions without verified actors are marked legacy/unattributed and are excluded from staff-owned lists.

These are migration requirements. The existing pilot remains owner-only until tested replacements are ready.

## Current application action inventory

All routes below ultimately require an authenticated shop owner today. The future operation permissions are specified in [the permission matrix](./staff-permission-matrix.md).

| Current actions/files | Current entry points | Future permission family |
| --- | --- | --- |
| `src/app/(shop)/record-sale/actions.ts` | `loadSaleCatalog`, `refreshSaleCatalog`, `loadCustomerMoneyOwed`, `saveSale`; `save_sale_with_old_debt_payment` | sales/create; sales/read; customers/read-balance |
| `src/app/(shop)/customers/actions.ts` | Add/edit/archive/restore customer, change empties-deposit requirements | customers/manage; customers/archive; empties/change-requirements |
| `src/app/(shop)/customers/[id]/pay/actions.ts` | `record_payment` | payments/record-debt |
| `src/app/(shop)/customers/[id]/opening-balances/actions.ts` | `record_opening_balances` | balances.create_opening |
| `src/app/(shop)/customers/[id]/return-empties/actions.ts` | `record_customer_empty_return` | empties/record-return |
| `src/app/(shop)/customers/[id]/held-actions.ts` | `release_held_empties` | empties/release-held |
| `src/app/(shop)/products/actions.ts` | Add/edit product, cost/selling price and crate associations | products/manage; pricing/sell; pricing/cost |
| `src/app/(shop)/products/[id]/photo-actions.ts` | Upload business product photo | products/upload-photo |
| `src/app/(shop)/products/catalogue/photo-actions.ts` | Master catalogue image change | catalogue/manage-platform (special) |
| `src/app/(shop)/stock/receive/[id]/actions.ts` | Review/confirm stock receipt; `receive_stock` | stock/receive |
| `src/app/(shop)/stock/count/[id]/actions.ts` | Review/confirm count; `set_current_stock` | stock/count; stock/adjust |
| `src/app/(shop)/empty-crates/count/actions.ts` | Review/confirm crate count; `set_empty_crate_count` | empties/adjust-stock |
| `src/app/(shop)/crate-types/actions.ts` | Create/edit/delete crate types, swap rules | packaging/configure |
| `src/app/(shop)/empties-rules/actions.ts` | Bottle and crate deposit prices | packaging/configure-prices |
| `src/app/(shop)/business/actions.ts` | Edit business name/address/logo | business/edit |
| `src/app/sign-in/actions.ts` | Password login, owner check, local logout | identity/sign-in; identity/sign-out |

**Read and export entry points to include next:** Home and manager snapshot, Products, Customers and customer details, Records and individual receipts, Sales, Activity, Empties, Stock, Business, and public verification. These need **read-visibility** permissions independently of action permissions. The receipt verification token must never become a way to enumerate unrelated businesses.

## Database migration scope

- **Identity and tenancy:** `businesses`, `business_memberships` (person, business, status, invitation state); permissions and role assignments scoped by business; durable staff history.
- **Root tables:** `shop_profile`, `customers`, `products` (shop assortment), `crate_types`, `sales`, `customer_payments`, `stock`, obligation/empty-stock tables, deposit/pricing policies.
- **Child and historical tables:** sale items, stock/empty movements, returns, held collections, opening balances, prices/cost histories, receipt business snapshots, idempotency reference tables and storage paths.
- **Shared catalogue:** define which rows are truly platform-shared. Global catalogue should not allow an ordinary business role to alter content for every depot.
- **Uniqueness and cross-table integrity:** replace singleton IDs and globally unique shop assumptions as appropriate. Add a business dimension to unique keys and indexes where the business, rather than the platform, owns the record. Prove cross-business foreign keys cannot connect.
- **Protected operations:** refactor all `SECURITY DEFINER` and public wrapper functions to check trusted identity, active membership, explicit permission and matching row/business in one transaction. Guard both direct column writes and RPCs. Avoid bypassing RLS accidentally.
- **Image access:** business-specific image keys must be tenant-scoped, with tightly controlled upload/delete policies and ownership validation; global packshots remain carefully managed.

## Phase 1 exit criteria

- [x] Inventory current authentication boundary, action files, database/table/RPC policy patterns and Supabase advisor results.
- [x] Draft role templates and separate `read`, `create`, `edit`, `adjust`, `approve`, `export`, `manage-access` permissions.
- [x] Define solo-operator, 2-person and multi-branch behavior as proposed defaults.
- [x] Create a staged migration/test/release plan with explicit stop/go gates.
- [ ] Approve default permissions and high-risk approval choices with product owner.
- [ ] Complete per-RPC authorization contract tests in disposable PostgreSQL before changing production checks.
- [ ] Perform detailed private security review of high-risk grants/advisor warnings; don't advertise sensitive findings in a public issue.
- [ ] Approve phase-2 tenant schema and historic-data backfill/rollback strategy. Read the [M1 business/membership blueprint](./business-membership-m1-blueprint.md) before proposing the first additive SQL migration.

## Reference points

`src/lib/auth/owner.ts`; `src/app/sign-in/actions.ts`; `src/app/(shop)/layout.tsx`; `supabase/migrations/20260912230917_initial_foundation.sql`; `supabase/migrations/20260913000019_owner_customers.sql`; `supabase/tests/foundation.sql`; `docs/security-checklist.md`. Production catalog inspection was **read only**. Supabase guidance: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database security advisors](https://supabase.com/docs/guides/database/database-linter), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
