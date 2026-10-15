# DepotFlow — Accounts, business isolation and security rollout

Status: **technical rollout proposal**, not implemented. Builds on [the current access audit](./access-control-phase1-audit.md) and [the permission matrix](./staff-permission-matrix.md).

## Target architecture

```text
auth.users (verified person / independent sign-in)
    |
    +--> businesses (distinct depots)
             |
             +--> business_memberships (user + business + active state)
             |       +--> role templates + explicit capabilities
             |       +--> current-session revocation and approvals
             |
             +--> customers, sales, payments, debts, returns, stock, prices...
                        |
                        +--> actor_user_id, immutable original receipts and audit
Master product catalogue (separate, platform governed)
```

**Design choice:** shared Postgres schema with strong `business_id` isolation, membership-aware RLS, matching business-aware relational constraints and privileged transaction checks. Do **not** use a user-owned `owner_user_id` as the business boundary. No user can assert permission by sending a forged `business_id`, user metadata or role name.

Use `business_id` on every tenant-owned top-level row and on dependent/historical rows where it is necessary for RLS, integrity, efficiency or audit. `auth.uid()` identifies the person but does not establish business membership by itself. Where useful, treat `(business_id, foreign_key)` as a validated composite reference so two businesses cannot accidentally share a customer/sale/stock movement via UUID substitution.

## Release milestones / stop-go gates

### M0 — Baseline and explicit product decisions (this PR)

- Inventory existing owner-only checks, RPCs, RLS, direct column grants, storage and shared-catalogue contracts.
- Get decisions on the role matrix, old debt at checkout, employee business-wide visibility, approvals, cost prices and owner recovery.
- Capture current counts and reconciliations of stock, debts, empty crates/bottles, receipts, payments, catalogue associations and idempotency records without copying customer personal information into developer logs.
- Record data types, PK/unique/check/FK constraints and every public/private RPC signature, so the migration can be tested using **the actual schema**.

**Gate:** approved role defaults + complete source/SQL contract inventory. No production changes.

### M1 — Add identity/business tables **without enabling staff access**

- Introduce `businesses`, owner and member tables with verified foreign keys to `auth.users`. Define separate permanent identity vs active membership. Design `role_templates`, `membership_permission_grants` and revocation rules.
- Create the current shop as one explicit business, assign the existing registered owner; keep `private.shop_owner` and existing owner-only auth intact as a compatibility fence.
- Membership must be non-transferable to another business via unprivileged UPDATE. Owner creation/invites require authenticated controlled server operations.
- Protect the final owner and avoid unrestricted self-registration, elevation or account deletion.

**Gate:** isolated PG tests prove only the existing owner can still access the current business, and a newly created test account gets no application data. Existing production checkout unchanged.

### M2 — Tenant-tag data and build hard isolation

- Classify every table as **global catalogue, business-owned, internal-only or public verification**. Do not blindly add `business_id` to truly global content.
- Backfill and constrain tenant ownership in safe batches, with separate migrations where locks/index changes are expensive. Design per-business uniqueness rather than globally shared shop identifiers.
- Update shop singleton assumptions (`shop_profile.id=true`), stock product keys, customer balance keys, packaging rules, price histories and receipt/return relationships. Preserve exact original historical receipt and business-name snapshots; do not overwrite old data.
- Define storage object paths per business with strict image-upload/delete policies; preserve rights-cleared globally shared catalogue packshots.
- **M2/M3 mutation audit prerequisite:** introduce a business-scoped append-only mutation audit with database-derived actor, affected resource, action, request ID, reason and safely redacted before/after values. It must cover all staff-delegated customer, products/costs/pricing, packaging/deposit configuration, stock adjustment, business identity, staff/permissions and waiver changes. Each privileged write records its audit atomically, including direct RPC access; no staff can forge, delete or edit logs. If a sensitive action cannot be audited by the M4 gate, keep it owner-only until M5.
- **M2 attribution prerequisite:** add immutable, verified `actor_user_id` + `business_id` (or equivalent authenticated provenance) for new sales, old-debt payments, receipts, opening balances, stock receipts/counts/adjustments and empties movements. Populate at the database transaction boundary using `auth.uid()`, never a client-supplied actor; backfill historical rows with an explicit **legacy/unattributed** classification, not an invented person. Preserve old receipt snapshots and ledger IDs. Stage safe backfill of existing business identity separately from author attribution.
- Validate `business_id` matching inside composite FKs/checks and atomic transaction functions. No path should reach another business by guessing a UUID.
- Keep staff feature disabled throughout. Do not widen read/write RLS policies while any tenant-owned table lacks reliable ownership.

**Gate:** every tenant-owned row tagged; reconciled row counts, stock, money, empties, receipt verification, idempotency and tenant-reference integrity. Cross-depot reads and writes fail on a disposable two-business database.

### M3 — Central DB authorization + atomic RPC conversion

- Introduce one centrally reviewed `can_business(user_id,business_id,permission)`-style contract (or equivalent) with active membership fetched from trusted DB data. Keep implementation in a non-exposed schema and prevent recursive/RLS bypass.
- Apply this to every public `SECURITY DEFINER` RPC, privileged private helper, invoker wrapper, direct column grant/policy and read view. Approve `SECURITY DEFINER` use only when unavoidable, with fixed `search_path`, careful grants and row-scoped checks.
- Use targeted permissions for `save_sale_with_old_debt_payment`, `record_payment`, `receive_stock`, stock count submission/finalization, `record_opening_balances`, customer/empties actions and sensitive pricing operations.
- **Split product metadata and selling-price updates:** current `products/actions.ts` combines them. Before granting staff `products.manage`, move selling-price fields behind `pricing.selling_edit` in a separate DB-enforced write path (or an atomic combined path checking both grants whenever prices change). Strip or reject price edits from metadata-only RPCs, direct table update grants and forged requests; audit price changes with previous and new values.
- **Do not map `stock.count_submit` to the existing `set_current_stock` RPC.** The live `confirmCount` action currently calls that RPC and immediately adjusts inventory. Before adding a Stock-role account, create a tenant-scoped, idempotent **pending-count record** and count-submit RPC that never alters booked stock. Finalizing a discrepancy must be a second atomic RPC guarded by `stock.finalize_variance`, checking active membership, optional approval, the expected stock version and current quantities. Keep the legacy direct count/finalize action owner-only until the two-step flow is verified.
- **Empty-crate physical counts also need two stages**: the live `set_empty_crate_count` RPC currently changes empty crate stock immediately. Add a business-scoped, idempotent `pending_empty_crate_counts` observation and distinct `empties.count_submit` permission, separate from `empties.finalize_variance`. Finalization rechecks book count and exact crate type before atomically posting a movement. Leave direct legacy empty-crate adjustment owner-only until both paths are tested.
- **Customer empties deposit waivers are sensitive**: current customer actions update `customers.empties_deposit_required` directly. Introduce separate `empties.deposit_waive_customer` and `empties.deposit_require_customer` grants. Owner can waive by default with confirmation/reason; Manager opt-in only, and `customers.manage` must not permit a waiver. Constrain both direct column writes and RPCs; audit before/after and owner.
- **Treat creating an opening balance as a high-risk write**: `record_opening_balances` must enforce the distinct `balances.create_opening` permission, not general customer management or payment collection. Owners have it by default; optional Manager/Accounts delegates need explicit grants, confirmation, reason, business/customer matching and an immutable audit record.
- **Do not reuse the public standalone payment entry point for checkout debt.** The current `save_sale_with_old_debt_payment` calls `public.record_payment`. Before staff rollout, refactor to a private non-exposed internal payment application routine (or audited equivalent): `public.record_payment` checks `payments.collect_old_debt_standalone` and cannot accept a checkout-only grant, while the combined sale RPC checks `payments.collect_old_debt_at_checkout` and invokes only the private internal path after checking the active member, target business and customer. Prevent direct helper access by clients and preserve atomicity/idempotency/receipt snapshots.
- **Conditionally enforce checkout-payment grants in one atomic DB call:** `sales.create` is always required, `payments.collect_at_checkout` is required only if `p_paid>0`, and `payments.collect_old_debt_at_checkout` only if `p_old_debt_paid>0`. For a mixed payment require all three; for an entirely unpaid sale only `sales.create`. Direct RPC requests get identical rules. `sales.create` alone does **not** implicitly include a paid sale.
- Use the verified user's `auth.uid()` and the active membership for authorization; cross-check customer/product/payment/return foreign keys with that business, never accept a caller-supplied actor.
- A disabled membership must stop a new request immediately, including a still-authenticated user with an old browser session. Do not rely only on stale JWT app_metadata.

**Gate:** production-equivalent, disposable PostgreSQL role-by-role tests. Unknown/disabled memberships get zero access even through direct PostgREST RPC calls. Pending drink-stock and empty-crate counts cannot change stock without separately authorized finalization; both checkout and standalone payment entry points are distinct and correctly guarded; customer deposit waivers require their own permission; every new transaction has an immutable, DB-derived actor; legacy rows remain unattributed. **All sensitive delegated mutations must create immutable actor/reason/before-after audit events or remain owner-only.**

### M4 — Staff access and the permission-aware interface

**M4 entry gate: verified step-up protection for any high-impact staff action.** If independent, fresh step-up authentication and auditable approval enforcement are not implemented by this stage, keep stock/empty variance finalization, historical opening-balance creation, voiding/correction and other high-impact powers owner-only. Do not advertise or enable a Manager/Accounts delegated grant until the DB entry point validates step-up and actor in the same transaction. Password/OTP/step-up secrets must not be stored in application tables.

- Adapt `requireOwner()` and protected layouts to `requireBusinessPermission()` and business-scoped data access, retaining a safe compatibility path during rollout.
- Account sign-in resolves approved memberships; only show a business picker for users with multiple active businesses. Invalid selected business fails closed.
- `More → Team & Access`: team list, invite, permissions, role bundles, disable access, pending invitations, owner security and audit entry.
- Never hide critical data without an explanation; unauthorized actions should not appear, while tampered/expired requests must still be rejected server-side.
- Staff screens focus on **their actual tasks**, not internal role claims. Solo owner sees the ordinary sales workflow without extra setup.
- **Do not enable `records.view_own` until persisted transaction actors and tenant isolation exist.** Staff only see transactions whose stored verified actor is their own user ID. Legacy rows have an explicitly absent/unattributed actor and are visible only under an authorized `records.view_all` scope; never infer ownership based on customer, timestamps or who happens to sign in.

**Gate:** staff can do only approved tasks across mobile/tablet/desktop; business switching cannot leak previous depot data through caches, paused sales, URL routing or browser state.

### M5 — Advanced audit, protection and access recovery

**Basic immutable actor attribution, business scope and minimal append-only change audit are mandatory in M2/M3, before any staff access.** M5 adds richer audit search, retention policy, optional dual approvals and recovery controls; it is not the first point at which actors or change events are saved.

- Build on the immutable actor and business references installed in M2/M3: add searchable audit events, safe before/after change data, review access and retention. Never log passwords, Auth tokens or unneeded customer personal data.
- Improve already-enforced M4-sensitive-action step-up with optional owner approval and two-person controls for larger teams, as well as accessible solo-owner reauthentication. Never introduce the **first** high-impact delegated step-up in M5. Prevent a non-owner self-approving or deleting past evidence.
- Harden compromised-password checks, MFA and account recovery; protect ownership transfer, owner lockout and break-glass recovery under separately audited controls.
- Review verified public receipts to minimize information exposure and prevent token enumeration or unbounded traffic; preserve the public receipt verification feature.

**Gate:** reason/actor preserved across voids, sensitive adjustments, member disablement and interrupted or uncertain saves. Access revocation is tested with two simultaneous browser sessions.

### M6 — Controlled adoption

1. Complete all disposable PostgreSQL migrations and tests first; obtain Codex/security review of the final implementation.
2. Rehearse on a sanitized or isolated representative copy of production data, including receipts and the heaviest product/customer accounts. Record integrity totals before/after.
3. Install **backward-compatible, additive** DB changes. No staff membership is active. Apply controlled data backfill and verify each batch.
4. Enable the new authorization model only once every data access route and RPC has been reviewed. Keep a temporary owner-only recovery path that **does not bypass tenant isolation**.
5. Canary one trusted additional account and one synthetic second business after isolation passes. Explicitly compare expected and denied access.
6. Monitor authentication failures, denied cross-tenant attempts, transaction conflicts and ordinary sale/payment/stock errors. Do not expose sensitive details in logs.
7. Increase access slowly. Preserve the ability to disable invitations and staff logins separately from core owner sales.
8. Retire `private.shop_owner` **only after** no live code or policy depends on it, and all tenants are proven isolated.

**Rollback reality:** App and feature flags can disable staff access quickly; PostgreSQL schema rollback after a financial data migration may be unsafe. Prefer forward-compatible additive changes, backed-up state and tested forward fixes. Never “restore” receipts or debts by dropping new ledger columns.

## Required negative tests (fail closed)

| Test actors | Expected result |
| --- | --- |
| No login / anonymous | No business records or privileged mutations; limited receipt token verification only |
| Signed-in account with no membership | No shop data, even if it knows customer IDs or RPC names |
| Disabled employee with existing session | Denied from the next protected DB operation |
| Sales employee | Can record permitted sales and checkout debt collection; cannot edit stock balances, prices, staff or purchase costs |
| Stockkeeper | Can receive stock and **submit a pending physical count** according to grants; cannot post a variance, call `set_current_stock` or alter customer money/debt |
| Manager without explicit pricing permission | Cannot edit selling/cost price by form, direct table write or RPC |
| Product metadata editor lacking `pricing.selling_edit` | Can edit permitted descriptive fields; direct/forged selling-price update rejected atomically without modifying price |
| Delegated manager without recent verified step-up | High-impact stock/empties variance, opening debt or correction denied, even when nominal role grant exists |
| Stockkeeper with only `stock.count_submit` | Pending count persisted without modifying booked inventory, sales or stock movements; separate finalization denied |
| Stockkeeper with only `empties.count_submit` | Pending empty-crate count persisted without changing booked empty stock or movements; direct `set_empty_crate_count` and finalization denied |
| Checkout caller has `sales.create` only | Zero-payment sale accepted; any positive `p_paid` or `p_old_debt_paid` rejected atomically |
| Checkout-debt-only caller invokes `public.record_payment` | Rejected: standalone payment requires `payments.collect_old_debt_standalone`; checkout uses non-exposed internal routine only |
| Sales staff with `customers.manage` waives customer empties deposit | Denied without `empties.deposit_waive_customer`; cannot bypass through direct column update, altered form or customer RPC |
| Staff edits price, product, customer, deposit rule, or team grants without audit | Mutation rejected or operation remains owner-only; permitted actions produce immutable business-scoped before/after audit |
| Checkout caller can collect new-sale payment only | New sale payment accepted; old-debt collection rejected without independent grant |
| Staff `records.view_own`, including legacy data | Only actor-matched, business-matched transactions visible; pre-attribution rows remain legacy/unattributed, visible only to `records.view_all` |
| Manager/Accounts without `balances.create_opening` | `record_opening_balances` rejects historical debt or crate/bottle obligation creation even if customer-edit/payment rights exist |
| Explicit opening-balance delegate | Audit reason, business/customer scope and all three money/crate/bottle effects checked atomically; retries do not double-charge |
| Accounts user without `sales.create` | Can record standalone debt payments when granted; cannot call combined sale checkout |
| Owner A in Business A | No read/write access to Business B records, products, costs, receipts or image objects |
| Multi-business member switching A → B | Only B data appears, including after browser back, parked sales and in-flight requests |
| Unauthenticated receipt verifier with valid token | Only minimal verified receipt fields, no customer list or financial account access |
| One-person owner | Routine sale/stock/payments work; sensitive actions require appropriate step-up/log, never unavailable second staff |
| Two-person team with approvals | Requested change requires a different eligible approver when configured |
| Crafted mixed-business sale | Atomic RPC rejects any customer/product/payment/empty item from a different business; no partial stock/debt writes |
| Retried save after network uncertainty | Same original sale returned; no duplicate sale, debt payment, stock movement or audit entry |
| Staff price/customer/owner modification attempt | Denied by PostgreSQL regardless of hidden UI or edited request body |

## Deployment discipline

- **No Vercel preview deployments**; branch work is reviewed through GitHub and disposable database checks. Production builds only when release gates are green.
- Never combine tenant backfill, privilege widening and live staff enablement into one huge release.
- For each stage publish: migration plan, reversible-app strategy, affected tables/RPCs, tests and proven data totals, owners approving the release, and no-go triggers.
- One failed cross-business isolation test blocks staff launch regardless of UI quality.
- Establish a separate private process for security vulnerabilities and Auth configuration before expanding accounts.

## Owners of remaining decisions

- **Product owner**: approve initial roles and what Sales/Manager can view, change and approve; set high-risk limits suitable for a Nigerian beverage depot.
- **Engineering**: implement tenant data boundaries, membership-checked RPCs, data-conversion scripts and UI transitions.
- **Security reviewer**: validate session revocation, privilege escalation, MFA/recovery, storage rules, public receipt surface and cross-tenant tests.
- **Business pilot operator**: verify that solo operation still works and two people can divide responsibilities naturally.

**Next engineering PR after Phase 1 is approved:** M1 identity + business/membership schema **without activating new users**. No staff UI before verified isolation.
