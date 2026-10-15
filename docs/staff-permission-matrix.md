# DepotFlow — Staff permission matrix (Phase 1 proposal)

Status: **proposed product defaults, not live authorization**. Confirm these defaults before implementing. The system must support one owner operating alone, two people sharing work, a full depot team and one person belonging to multiple depots.

## Model

- **Account**: a person authenticated by Supabase Auth. Never share logins.
- **Business**: a separate depot, inventory, customer book and accounting ledger. One login can hold different memberships in different businesses.
- **Membership**: `(user_id, business_id)` with active/invited/disabled status. A membership belongs to exactly one business; revocation is checked fresh for every privileged operation.
- **Role template**: Owner, Manager, Sales, Stock, Accounts. Templates are only convenient **starting permissions**.
- **Permission**: an explicit action and resource. One person may receive multiple compatible permission bundles; an owner can add/revoke capabilities deliberately.
- **Data scope**: permissions also restrict *which rows*: `own-activity`, `business-wide`, or `platform-catalogue`. A permission to see sales does not automatically permit seeing margins, all accounts or another depot.
- **Owner invariant**: every active business has at least one verified owner; changing ownership and removing the final owner cannot be routine staff operations.

**Notation:** ✓ default grant; — no grant by default; ○ separate opt-in grant (not a second role); † sensitive operations require an extra safeguard. Owner grants are scoped **only to their business**. The platform administrator is a separate authority.

| Capability | Owner | Manager | Sales | Stock | Accounts |
| --- | :---: | :---: | :---: | :---: | :---: |
| View operational Home snapshot for own business | ✓ | ✓ | ○ | ○ | ○ |
| Find customers and see debt amount needed for checkout | ✓ | ✓ | ✓ | — | ✓ |
| View full customer debt/payment history | ✓ | ✓ | ○ | — | ✓ |
| Add/edit customer contact details | ✓ | ✓ | ✓ | — | ○ |
| Archive/restore customers | ✓ | ○ | — | — | — |
| Waive a customer's mandatory empties deposit requirement | ✓† | ○† | — | — | — |
| Record new sale, including permitted returns | ✓ | ✓ | ✓ | — | — |
| Record payment for **new sale** during checkout | ✓ | ✓ | ✓ | — | — |
| Record **old-debt payment in same checkout** | ✓ | ✓ | ✓ | — | ✓* |
| Record standalone repayment of previous debt | ✓ | ✓ | ○ | — | ✓ |
| View own recorded sales and receipts | ✓ | ✓ | ✓ | — | ✓ |
| View/export full business sales history | ✓ | ✓ (view) | ○ (view) | — | ✓ (view) |
| View operational stock quantities | ✓ | ✓ | ✓ | ✓ | ○ |
| Receive stock and view supplier delivery | ✓ | ✓ | — | ✓ | — |
| Submit a physical drink-stock count **without changing stock** (future workflow) | ✓ | ✓ | — | ✓ | — |
| Submit a physical empty-crate count **without changing empty stock** (future workflow) | ✓ | ✓ | — | ✓ | — |
| **Finalize empty-crate variance/write-off** | ✓† | ○† | — | ○† | — |
| **Finalize stock variance/write-off** | ✓† | ○† | — | ○† | — |
| Create historical opening money/crate/bottle obligations | ✓† | ○† | — | — | ○† |
| Record physical empties returns / release held empties | ✓ | ✓ | ✓ | ✓ | — |
| Configure crate compatibility/deposit rules | ✓† | ○† | — | — | — |
| Create fully priced, sale-ready product | ✓† | ○† | — | — | — |
| Edit only non-financial, non-packaging product descriptions | ✓ | ○ | — | — | — |
| Change selling prices | ✓† | ○† | — | — | — |
| View business **purchase cost / margin / profit** | ✓ | ○ | — | — | ○ |
| Change business purchase costs | ✓† | ○† | — | — | ○† |
| Edit business identity/receipt header | ✓† | ○† | — | — | — |
| Void/correct a saved sale or payment (**future** workflow) | ✓† | ○† | — | — | ○† |
| Export sensitive customer/financial data | ✓† | ○† | — | — | ○† |
| View employee action/audit history | ✓ | ✓ | — | — | ○ |
| Invite, disable or change staff permissions | ✓† | ○† | — | — | — |
| Transfer business ownership / delete business (**future**) | ✓† | — | — | — | — |
| Edit the **global master product catalogue** | — | — | — | — | — |

`*` Accounts can collect old debt separately; using a combined sale checkout additionally requires the permission to record a sale. An Accounts role alone cannot create a sale. The matrix does not override that dependency.

**Current implementation discrepancy (release blocker):** `reviewCount` only previews the entered value, while `confirmCount` immediately invokes the privileged `set_current_stock` RPC and adjusts inventory. There is **no persisted pending physical count today**. The proposed Stock role can submit a count only after the pending-count workflow exists and is tested; until then the current final stock adjustment path must remain owner-only. Merely hiding the "Confirm" button or renaming the permission would be unsafe.

**Empty-crate counts are equally sensitive:** The current `confirmEmptyCrateCount` invokes `set_empty_crate_count`, which immediately modifies `empty_crate_stock` and writes a movement. Introduce persisted `pending_empty_crate_counts` and an independent `empties.count_submit` RPC that cannot modify stock, then a separate `empties.finalize_variance` finalization RPC with active membership, permissions, fresh stock validation and audit. The existing direct adjustment remains owner-only before conversion.

**Empties deposit-waiver safeguard:** The existing `allowCustomerToOweEmpties` and `requireCustomerEmptiesDeposit` actions update `customers.empties_deposit_required`. This changes financial exposure, so `empties.deposit_waive_customer` (for waiving the deposit) and `empties.deposit_require_customer` (for requiring/restoring it) are separate from `customers.manage` and depot-wide `empties.change_rules`. Owner can waive by default with confirmation, reason and audit; Manager only with explicit opt-in; Sales/Stock/Accounts never by default. Staff direct column updates must be revoked or protected by equivalent RLS/trigger enforcement. A salesperson's customer-edit permission must not permit this override.

**Opening-balances safeguard:** `recordOpeningBalances` invokes `record_opening_balances` and directly changes money owed and physical crate/bottle obligations. `balances.create_opening` is a distinct, high-risk operation with exact role defaults shown above; it is never implied by `customers.manage`, `sales.create`, `payments.collect_old_debt_standalone`, or any other generic role.

**Important:** a salesperson who can receive a customer payment is **not** automatically allowed to change debt directly, refund cash, void a sale, alter past receipts or modify pricing. Future corrections are separate operations with distinct approvals and audit.

## Permission keys and dependency rules

These keys are proposed names for the server and SQL layers; do not implement raw strings piecemeal before the central authorization API exists.

| Domain | Example permission keys | Required rule |
| --- | --- | --- |
| Business identity | `business.view`, `business.edit`, `business.switch` | Active membership in target business; switch never grants more permission |
| People | `team.view`, `team.invite`, `team.manage_permissions`, `team.disable` | Cannot escalate own rights, remove last owner or switch another business's staff |
| Customers | `customers.list`, `customers.view_balance`, `customers.manage`, `customers.archive` | Sensitive history separate from minimal checkout debt amount |
| Sales | `sales.create`, `sales.view_own`, `sales.view_all`, `sales.correct` | `sales.create` grants recording sale lines (which may be unpaid); **not** permission to collect money. Existing combined checkout remains atomic; conditional extra payment permissions enforced inside that same DB RPC. Corrections distinct. |
| Money | `payments.collect_at_checkout`, `payments.collect_old_debt_at_checkout`, `payments.collect_old_debt_standalone`, `payments.view_all` | Every checkout always requires `sales.create`; if `p_paid > 0`, additionally require `payments.collect_at_checkout`; if `p_old_debt_paid > 0`, additionally require `payments.collect_old_debt_at_checkout`. Both positive means **all three**. No separate permission for saving a zero-paid sale. Enforce inside the atomic DB RPC, including direct calls. |
| Historical opening balances | `balances.create_opening`, `balances.view_opening` | Recording opening debt/empties is **not** the same as accepting a payment or editing a customer. Separate, high-risk permission granted to Owner by default; optional Manager/Accounts delegation only with reason, confirmation, actor audit, scoped customer and amount/type revalidation. Existing `record_opening_balances` must check this permission at the database layer before staff rollout. Do not grant to Sales or Stock automatically. |
| Stock | `stock.view`, `stock.receive`, `stock.count_submit`, `stock.finalize_variance` | **Not true today.** Current `confirmCount` calls `set_current_stock`, immediately changing stock. Before stockkeeper grants, add a business-scoped `pending_stock_counts` record/submit RPC that writes *only* the observed physical quantity, reason, actor, date, expected book quantity and immutable request ID. Separate, explicitly authorized finalization checks fresh quantities/version, calculates variance, atomically posts adjustment, and marks the request finalized. No count-submission RPC may call `set_current_stock` or modify `stock`. |
| Empties | `empties.view`, `empties.return`, `empties.release_held`, `empties.count_submit`, `empties.finalize_variance`, `empties.adjust_stock`, `empties.change_rules`, `empties.deposit_waive_customer`, `empties.deposit_require_customer` | Physical empty-crate **count submission** cannot call `set_empty_crate_count` or change booked empties; it writes an idempotent pending observation. An independently authorized finalization revalidates exact crate type, book quantity/version, business, actor and approvals before changing empty stock. Keep `set_empty_crate_count` owner-only until converted; crate and bottle obligations never merge by family. |
| Products and prices | `products.manage`, `pricing.selling_edit`, `pricing.cost_view`, `pricing.cost_edit` | Separate selling-price work from private purchase costs/profit |
| Records | `records.view_own`, `records.view_all`, `records.export`, `records.audit_view` | **Actor IDs must be persisted before staff access.** New sale/payment/receiving/count/empties transactions store verified actor and business at database write time (never caller-supplied). Existing legacy history has no trustworthy actor: only Owner and `records.view_all` users may see it; it must **not** be inferred as belonging to the signed-in staff user. Staff `records.view_own` sees only records whose stored actor equals `auth.uid()`. |
| Platform catalogue | `platform.catalogue_manage` | Not grantable by ordinary business owner/manager |

## Payment entry-point separation (mandatory before staff)

The current `save_sale_with_old_debt_payment` invokes `public.record_payment`, which will be unsafe if we simply add a standalone debt-payment permission to that wrapper. Split the authorization contracts:

- Direct call to **`public.record_payment`** is *only* for standalone debt collection and requires `payments.collect_old_debt_standalone`. Possessing `payments.collect_old_debt_at_checkout` must never authorize calling this public endpoint.
- **`public.save_sale_with_old_debt_payment`** requires `sales.create`, conditional `payments.collect_at_checkout` for `p_paid>0`, and `payments.collect_old_debt_at_checkout` for `p_old_debt_paid>0`.
- Both permitted paths execute a **private, non-API internal payment application** (or independently implemented equivalent) within a single database transaction *after* their own entry-point business, active-membership and capability checks. Keep the helper outside exposed schemas, revoke unneeded `EXECUTE` grants, protect its definer/invoker context, and prevent a staff user from calling it via another exposed wrapper.
- Preserve the existing payment idempotency key, receipt snapshots, balance lock/revalidation and atomic all-or-nothing sale save. Do not call the public standalone payment API from the checkout path, and never give a checkout-only employee the standalone permission simply to make mixed checkout work.
- Negative tests: checkout-only can pay old debt **only inside a valid sale**; cannot directly call standalone payment RPC; standalone-only cannot perform a sale/combined checkout; forged customer/business or cross-business payment denied; retry never duplicates cash receipts.

## Transaction attribution and legacy-record visibility

The identity that signed in is not the business owner and is not necessarily the operator who created each record. Before staff are enabled, install DB-enforced immutable `actor_user_id` and `business_id` (or independently verifiable event actors) across sale, payment, stock receipt/count/adjustment, empties return, opening balance, audit and associated receipt. The database populates the actor from verified `auth.uid()` in the actual save transaction. Transaction groups such as sale + old-debt payment share the true actor and remain separate ledger entries. No staff role may update, forge or erase actor attribution.

Historical rows with no verified actor must remain `legacy/unattributed`, not assigned to the current owner or any employee. `records.view_own` explicitly excludes such rows. `records.view_all` may include them subject to business membership. M4 (team access) is **blocked** until author fields, read filters, indexes and historical classification are implemented and tested in M2/M3.

## Stock count and opening-balance negative tests required before staff access

- A Stock-role user with only `stock.count_submit` can create an immutable pending count and view it, but **cannot** change `public.stock`, call `set_current_stock`, finalize a variance, authorize themselves or mutate a finalized count.
- Replaying the same stock-count request ID returns the original pending/final result; a different request ID must not bypass quantity/version checks.
- A Stock-role user with only `empties.count_submit` can submit a dated physical empty-crate count without altering `empty_crate_stock` or creating stock movements. The user cannot execute `set_empty_crate_count` or finalize `empties.finalize_variance`.
- Finalizing a pending empty-crate count checks exact crate type, current book quantity/version and permissions, then records one atomic movement with immutable actor. Duplicate or stale requests do not overwrite stock.
- Owner or separately authorized Manager can finalize a pending count only when current book stock/metadata are revalidated; no stale count silently overwrites sales or recent receipts. A variance that needs another approver is held until one is granted.
- A Sales user with `customers.manage` cannot directly update `customers.empties_deposit_required` to waive a deposit, invoke a waiver RPC, or forge a permission flag. A Manager without explicit `empties.deposit_waive_customer` is also denied. A waived requirement requires actor/reason, current business/customer verification and pre/post audit in the same transaction.
- An unprivileged Sales, Stock or ordinary customer-editor account cannot invoke `record_opening_balances` directly, even with a valid customer ID, guessed business ID or edited payload.
- A Manager/Accounts user **without** explicit `balances.create_opening` cannot add historical debt/empty obligations; an enabled delegate still needs a reason, exact business match and an audit entry.
- An opening-balance retry uses its idempotency key; a failed transaction must not partially change money owed or crate/bottle obligations. A user revoked during a session is denied on their next operation.

## Conditional checkout-payment negative tests

- A user with `sales.create` but no payment permission can record an unpaid sale (`p_paid=0, p_old_debt_paid=0`) but **cannot** save any sale with `p_paid>0` or `p_old_debt_paid>0`.
- `sales.create + payments.collect_at_checkout` can record a paid new sale but **cannot** settle previous debt without `payments.collect_old_debt_at_checkout`.
- `sales.create + payments.collect_old_debt_at_checkout` can settle earlier debt in an otherwise unpaid new sale but **cannot** accept payment for new drinks without `payments.collect_at_checkout`.
- All three grants permit a mixed checkout. Every allowed checkout is still atomic and idempotent, with no partial stock/debt/payment writes if a permission is missing.
- A staff user with `records.view_own` sees only business-matched records explicitly attributed to that user; legacy/unattributed records and another employee's receipts remain hidden, while authorized Owner/Manager/Accounts `records.view_all` can see them. Attribution cannot be spoofed with a JSON or RPC parameter.

## Product editing versus selling-price authority

Today `src/app/(shop)/products/actions.ts` submits product metadata and selling-price fields in one update. That combined entry point **must be split before staff roles are enabled**. A user with only `products.manage` may edit **only** harmless descriptive fields (name, size, approved image, plain product description), but cannot change `full_crate_price`, `half_crate_price`, `quarter_crate_price`, `bottle_price` or derived selling-price configuration. A price change uses a separate `pricing.selling_edit`-guarded RPC/action, writes an immutable before/after audit event and validates current stock/product metadata. The database rejects price-field updates through the metadata endpoint and direct PostgREST updates. If a combined interface remains, the DB checks **both grants** when any selling-price field changes. Preserve a product's unchanged prices when a metadata-only editor saves.

**Packaging fields are never descriptive-only:** `bottles_per_crate`, `crate_type_id`, `bottles_returnable`, `bottle_type`, units, empties requirements and compatible replacements all affect stock conversion and obligations. Editing these requires independent `packaging.configure_product`, explicit pre/post audit, verification of existing stock/sales/empties balances and a protected conversion/reconciliation path. For stocked/sold products, a casual UPDATE is rejected; historical snapshots remain immutable. `products.manage` does not grant these changes.

**Initial product price is not an exception:** Existing `products.full_crate_price` is NOT NULL, so ordinary staff may **not** create a new product with `products.manage` alone. Creation of a sellable product must atomically require `products.create_sellable` plus `pricing.selling_edit` and `packaging.configure_product` (or Owner's full capability). Default Manager is **not** a product creator. Draft product creation without a required initial selling price would need a separate future schema/UI change and is not assumed for this release. Direct INSERT and API requests must enforce the same rules.

Negative tests: a metadata-only editor cannot set pack size, bottle returnability or crate type; no resulting change to stock or obligations. A user with only `products.manage` cannot INSERT a sellable product with `full_crate_price`; an explicitly authorized product creator with the correct selling-price and packaging grants can. Stocked product pack changes require a separately approved conversion with audit. Metadata-only Manager edits a product name successfully but a forged price field is denied, without partial metadata/price writes; a selling-price editor can change prices under its separate grant and audit; a direct price-column UPDATE and modified form cannot bypass the check.

## Approval and audit rules

A task can be handled by one person, two people or a larger team.

1. **Ordinary work** (recording sales, approved payments, receiving correctly ordered stock, recording empties): no unnecessary approval. Log `actor_user_id`, `business_id`, `occurred_at`, source record and request ID. **Before enabling staff**, make a minimal immutable mutation-audit event available for all delegated write actions, including who changed customers, pricing, product setup, packaging/deposits, shop identity and team permissions. The audit uses safe field-level changes or redaction rather than exposing unnecessary customer PII.
2. **Sensitive, reversible settings** (selling prices, business identity, crate/deposit rules, staff permissions): require re-confirmation, reason where appropriate, log before/after change. Optionally require owner approval for manager/staff changes.
3. **High-impact transactions** (voiding money records, finalizing stock variances, creating historical opening balances, ownership transfer): explicit separately granted permission, a reason, audit and step-up authentication. For multi-person teams, optionally require another qualified approver.
4. **One-person depot**: never block core operation due to absent second employee. Owner can perform sensitive actions with step-up confirmation, documented reason and tamper-resistant audit. This is *not* automatic permission for non-owner staff to self-approve.
5. **No approval through editable UI state**: check approval status, actor permission and target business in the same database transaction as the change. Record both requester and approver where a two-person approval is used.

### Step-up authentication must precede delegated high-impact actions

Before M4 enables **any staff** grant for `stock.finalize_variance`, `empties.finalize_variance`, `balances.create_opening`, `sales.correct`, `business.transfer_ownership` or other high-impact operations, the DB write path must validate a recent trusted step-up authentication event, the active member and explicit capability **within the same authorized transaction**. Do not accept a checkbox, request-supplied authentication time or stale JWT-only flag. If step-up and approval have not been implemented and tested, these operations **remain owner-only and cannot be delegated**, even if the UI lists a potential opt-in grant. For an owner, requiring recent reauthentication and an audit reason is an acceptable first step; optional two-person approval is separate.

Negative tests: a Manager with a nominally configured high-impact grant but no recent verified step-up cannot finalize stock or add opening debts; a forged confirmation fails; an expired step-up fails; approved owner operation succeeds with immutable reason and audit.

### Audit precondition for delegation

Operational actor attribution alone is not enough. By the M3→M4 gate, install an append-only, business-scoped mutation log recording database-derived actor, time, action, affected resource, request ID, reason when required and safe before/after values. Clients cannot INSERT an event while spoofing its actor, edit/delete events, or bypass the log by calling a privileged RPC directly. The audit of permission grants, disabling users, waiver changes and pricing changes must occur atomically with the mutation. If any operation lacks enforceable audit, **keep that specific operation owner-only** until its audit contract is delivered. M5 enhances searches, retention and dual approvals; it does not introduce the first audit events.

## Invite and account lifecycle

- Owner enters an employee email and selects a **business** and bundle(s). Invitation expires, is single-use, bound to that email/business and can be revoked.
- Invite acceptance verifies identity; user receives a pending membership until accepted and activated. No unapproved self-service staff registration.
- Staff sign in with their own credentials. Use email verification; plan for owner MFA / step-up authentication. Never store raw passwords in DepotFlow tables.
- Every request checks membership **now**; `disabled` must take effect on the next protected query and not depend on waiting for a JWT to expire.
- Suspension does not delete historical records. A transaction records immutable actor ID plus a safe display-name snapshot (if permitted); transfers between businesses do not change authorship.
- A person may manage multiple shops with one account, but permissions differ per shop; business switch must be explicit and obvious.
- Prevent privilege escalation: managers cannot grant permissions they do not hold or override protected owner settings; no automatic platform-superuser access to business financial records.
- Password reset, account recovery, changing email and ownership transfer need independent identity checks. Admin support access, if ever offered, must be deliberate, time-limited, logged and visible to the business owner.

## Decisions to approve before Phase 2

1. **Multi-business from the beginning?** Recommendation: **yes**, at the database level. One login can hold multiple memberships.
2. **Can a salesperson collect old debt at checkout?** Recommendation: **yes by default**; standalone debt collection is opt-in.
3. **Can employees see every sale?** Recommendation: Sales sees own receipts by default; Manager/Accounts can see all business transactions; Owner controls expanded access.
4. **Should managers see purchase prices/profit automatically?** Recommendation: **no**; grant separately.
5. **Can managers invite or remove employees?** Recommendation: **owner only by default**; a limited delegated ability can be added later.
6. **Should a stockkeeper finalize stock variances?** Recommendation: can count by default; final adjustment requires explicitly granted permission/approval.
7. **Who owns the master catalogue?** Recommendation: platform-managed shared definitions, with per-business product/price overrides.
8. **Public receipt verification:** Recommendation: preserve verification by unguessable token with limited public fields; never require anonymous access to private customer books.

No default is final until approved. Implement permissions in **one central policy registry** used by both UI and database; treat frontend checks as presentation only.
