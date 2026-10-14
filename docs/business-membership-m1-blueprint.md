# M1 blueprint — Safe business and membership foundations

Status: **design only — no SQL migrations or staff enablement**. This document defines how to ship the first additive database milestone once the permissions policy is approved. It depends on [the audit](./access-control-phase1-audit.md), [matrix](./staff-permission-matrix.md) and [rollout](./accounts-security-rollout.md).

## Verified legacy assumptions that must continue to work

- `private.shop_owner` has a singleton boolean primary key (true) and a unique `auth.users(id)` reference.
- `public.shop_profile.id` is boolean, not a business UUID.
- `public.stock.product_id` is the stock key, not `(business_id, product_id)`. This is a **future M2** data-model change.
- Customers, sales, customer payments, obligations and operational stock tables do **not** have `business_id` yet.
- Current `is_shop_owner()`, action and RPC checks must remain in force until *every* business-owned object is migrated and cross-tenant tested.
- Master product catalogue is potentially global; `public.products` is the business assortment. Do not treat them as the same tenant-owned resource.

## Additive M1 schema (proposal)

Place initial tables in non-exposed `private` schema, with RLS enabled, grants/revokes explicitly written and no broad `anon`/`authenticated` table write access. Migration should create only *schema and single current-owner mapping*:

| Object | Essential fields / constraints | Access |
| --- | --- | --- |
| `private.businesses` | `id uuid PK`, `created_at`, `status` (active/suspended), optional display reference; never migrate `shop_profile` in this stage | No direct API list/write by default |
| `private.business_memberships` | `business_id FK`, `user_id FK auth.users`, `status` (active/disabled/invited), `member_kind` (owner/employee), timestamps, composite key `(business_id,user_id)` | No direct self-insert, self-update, or cross-business read |
| `private.business_permission_grants` (future milestone) | `business_id,user_id,permission_key`, FK membership, allowlist, explicit grant history | Not introduced to active policy yet |
| `private.business_invitations` (future milestone) | Business, invitee email binding, expiry, revocation, one-time token hash | No public invitation endpoint in M1 |

Initially, **only the existing owner becomes a member** of the current business. Do not create a second public business or invite a test user in production. The current shop remains a single operational tenant until M2 refactors tenant-owned tables, FKs and RPCs.

### Owner backfill safety

1. Assert **exactly one** `private.shop_owner` record and a resolvable `auth.users` row before attempting an owner migration.
2. Create one `private.businesses` row for the existing depot; link owner membership `(business_id, user_id, active, owner)` transactionally.
3. Make the backfill **idempotent** using an explicitly recorded legacy-business mapping and uniqueness protection; never accidentally create a new business per retry.
4. Do not fetch/emit or log customer PII. No receipt, sale, stock, payment or debt rows change in M1.
5. Never change the old `private.shop_owner` singleton or `public.is_shop_owner()`; they are the explicit compatibility fence.
6. Prevent an unprivileged user from forging a business membership or turning their own membership into `owner`, even by direct SQL/PostgREST attempts.
7. Preserve a recovery path if owner mapping cannot be established. A failed validation must abort the transaction with no partial membership or business.

### Membership security and eventual usage

- A membership is a *business-specific relationship*. `auth.uid()` alone is insufficient for access.
- `active` is read live from the database on each privileged operation. Disabled employees cannot rely on a valid old JWT.
- Identity changes and ownership transfer require a separate audited, step-up flow. At least one verified owner per active business must remain.
- No business selection stored in editable request content, cookies or local storage can override an actual membership check.
- A single identity may have different memberships in multiple businesses. A membership in business A must never authorize touching B.
- Owner/admin/platform accounts remain separate; service keys must never reach browser code.

## M1 verification: disposable PostgreSQL first

- Authorized existing owner has a single active owner membership; repeated migration/backfill does not duplicate rows.
- Unknown authenticated user sees no business data and cannot self-enroll or change membership status.
- Two synthetic businesses and two distinct users demonstrate that membership is scoped; one cannot read/modify the other's membership.
- Disabling a test membership prevents the next protected action (a future authorization function can be tested before binding any operational data).
- Removing/downgrading the only owner is prohibited by protected DB operations; a direct lower-privilege bypass is denied.
- Every original sale/stock/payment/receipt/customer count and important total remains equal before/after the additive schema test.
- All legacy `is_shop_owner()`, `save_sale_with_old_debt_payment`, `record_payment`, `record_customer_empty_return` and stock RPC security tests continue to pass.
- New `private` tables are not exposed in the Data API, have RLS enabled, and deny `anon` and unprivileged `authenticated` direct writes; no new public `SECURITY DEFINER` entry points appear.
- Simulate interrupted/duplicate migration and lock hazards on an isolated copy before proposing a production execution window.

## Non-goals and release fences

M1 does **not** grant staff access, enable business switching, change `shop_profile`, migrate product IDs, add invitations, or replace existing owner checks. M1 is explicitly **not** proof of data isolation because the operational rows still lack business scoping.

**No deploy** until all scripts and tests are independently reviewed and the product owner confirms the default permission policy. Keep branch previews disabled. No direct Supabase production DDL from this design document.

## Immediate next engineering artifact

A separate M1 implementation PR containing an additive migration, matching disposable PostgreSQL tests and a pre/post reconciliation script **without** staff UI or permission-enabling changes. It should stop before production installation until reviewed.
