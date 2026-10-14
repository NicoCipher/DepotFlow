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
| Record new sale, including permitted returns | ✓ | ✓ | ✓ | — | — |
| Record payment for **new sale** during checkout | ✓ | ✓ | ✓ | — | — |
| Record **old-debt payment in same checkout** | ✓ | ✓ | ✓ | — | ✓* |
| Record standalone repayment of previous debt | ✓ | ✓ | ○ | — | ✓ |
| View own recorded sales and receipts | ✓ | ✓ | ✓ | — | ✓ |
| View/export full business sales history | ✓ | ✓ (view) | ○ (view) | — | ✓ (view) |
| View operational stock quantities | ✓ | ✓ | ✓ | ✓ | ○ |
| Receive stock and view supplier delivery | ✓ | ✓ | — | ✓ | — |
| Enter a physical stock count | ✓ | ✓ | — | ✓ | — |
| **Finalize stock variance/write-off** | ✓† | ○† | — | ○† | — |
| Record physical empties returns / release held empties | ✓ | ✓ | ✓ | ✓ | — |
| Configure crate compatibility/deposit rules | ✓† | ○† | — | — | — |
| Add/edit products and selling assortment | ✓ | ✓ | — | ○ | — |
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

**Important:** a salesperson who can receive a customer payment is **not** automatically allowed to change debt directly, refund cash, void a sale, alter past receipts or modify pricing. Future corrections are separate operations with distinct approvals and audit.

## Permission keys and dependency rules

These keys are proposed names for the server and SQL layers; do not implement raw strings piecemeal before the central authorization API exists.

| Domain | Example permission keys | Required rule |
| --- | --- | --- |
| Business identity | `business.view`, `business.edit`, `business.switch` | Active membership in target business; switch never grants more permission |
| People | `team.view`, `team.invite`, `team.manage_permissions`, `team.disable` | Cannot escalate own rights, remove last owner or switch another business's staff |
| Customers | `customers.list`, `customers.view_balance`, `customers.manage`, `customers.archive` | Sensitive history separate from minimal checkout debt amount |
| Sales | `sales.create`, `sales.view_own`, `sales.view_all`, `sales.correct` | `sales.create` includes atomically saving sale lines/payment; corrections distinct |
| Money | `payments.collect_at_checkout`, `payments.collect_old_debt_at_checkout`, `payments.collect_old_debt_standalone`, `payments.view_all` | Combined sale+old debt requires `sales.create` **and** `payments.collect_old_debt_at_checkout` |
| Stock | `stock.view`, `stock.receive`, `stock.count`, `stock.finalize_variance` | Counts can be submitted without granting destructive stock adjustment |
| Empties | `empties.view`, `empties.return`, `empties.release_held`, `empties.adjust_stock`, `empties.change_rules` | No substitutions/merging of incompatible crate/bottle obligations |
| Products and prices | `products.manage`, `pricing.selling_edit`, `pricing.cost_view`, `pricing.cost_edit` | Separate selling-price work from private purchase costs/profit |
| Records | `records.view_own`, `records.view_all`, `records.export`, `records.audit_view` | Read rights are independently scoped; no default exports for Sales |
| Platform catalogue | `platform.catalogue_manage` | Not grantable by ordinary business owner/manager |

## Approval and audit rules

A task can be handled by one person, two people or a larger team.

1. **Ordinary work** (recording sales, approved payments, receiving correctly ordered stock, recording empties): no unnecessary approval. Log `actor_user_id`, `business_id`, `occurred_at`, source record and request ID.
2. **Sensitive, reversible settings** (selling prices, business identity, crate/deposit rules, staff permissions): require re-confirmation, reason where appropriate, log before/after change. Optionally require owner approval for manager/staff changes.
3. **High-impact transactions** (voiding money records, major stock adjustments, changing historical opening balances, ownership transfer): explicit separately granted permission, a reason, audit and step-up authentication. For multi-person teams, optionally require another qualified approver.
4. **One-person depot**: never block core operation due to absent second employee. Owner can perform sensitive actions with step-up confirmation, documented reason and tamper-resistant audit. This is *not* automatic permission for non-owner staff to self-approve.
5. **No approval through editable UI state**: check approval status, actor permission and target business in the same database transaction as the change. Record both requester and approver where a two-person approval is used.

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
