# Split tender checkout contract (issue #116)

Status: **domain-only foundation**. Do not turn on split tender in production until the database, receipts, public verification, and financial history support it atomically. Existing single Cash, Transfer and POS transactions remain unchanged.

## Exact UX

Keep the present sale amount and *old-debt* amount inputs independent. The payment method section offers **One method** (existing Cash / Transfer / POS) or **Cash + Transfer**. Only in split mode show Cash received and Transfer received, a collection sum and clear shortfall/excess. Pay later stays zero without demanding a tender method; when only one method has a positive amount, use One method rather than fake a split.

For a split, two strictly positive legs must sum exactly to `paid today's sale + paid old debt`. Allocation defaults to **cash used toward today's sale first**, transfer fills any remaining sale payment and previous debt. Show this explicitly in Review. When paying prior debt, offer an optional control to change the amount of cash applied to today's sale; the remaining cash applies to old debt and transfer fills the rest. Example: sale ₦1,500 + debt ₦500, cash ₦500 + transfer ₦1,500 can allocate all cash toward old debt when the operator chooses cash-for-sale ₦0. Never silently infer a different intent on receipts.

The operator sees one consolidated amount due, without collapsing sale revenue and old-debt collection into one category. The confirmation action remains deliberate and protected from double taps. Customer status and crate/bottle returns remain accessible without huge vertical blocks.

## Required database/financial implementation, BEFORE feature flag enablement

1. Add an **immutable sale tender legs** table linked to the saved sale with exact whole-naira `sale_amount` and `old_debt_amount` and method. The old-debt receipt must be linked to its related tender legs. Enforce no negative values, `amount = sale_amount + old_debt_amount`, unique per sale+method, and total equality of each allocation through the new authenticated atomic RPC. No plain client inserts, RLS read restricted to the owner; the transaction must roll back *all* writes if any validation fails.
2. Do **not** extend the old RPC to accept `mixed` without an atomic ledger. Version the save RPC and use it only after the migration is verified. Preserve legacy single-method records and public verification. Never backfill fabricated cash/transfer amounts. Receipt readers and public receipt verification must display Cash and Transfer with their actual amounts, and the old-debt receipt must show only its corresponding allocations.
3. A request-ID retry must return the original sale and original legs; changed legs with the same ID must be rejected. Preserve existing uncertain-save `Check Sale` path, and do not attempt any live writes during migration/testing.
4. Verify complete receipt, Sales details, Customers history, Activity, public verification, printed/shareable receipts and old-debt receipt. Legacy single-method receipts must remain correct.
5. Write database SQL regression tests for full/partial/unpaid, incorrect totals, duplicate method, concurrent same customer, idempotent repeat with different allocation, price/stock drift, unauthorized caller, failed/unknown save, and legacy receipts.

## Migration release gate

Current production migrations have different version numbers from the repository's migration filenames (including October 14 and 15). Inventory the precise versions and meaning before shipping DDL; do not blindly `db push` or repair migration history. The multi-business PR #107 must stay isolated. Verify new migration in disposable Postgres CI, code/security review it, apply it with the approved Supabase migration mechanism, and confirm the exact production schema before enabling the new UI and deploying client code.

## Domain invariants

`allocateSplitTender` and `validateTenderLegs` in `src/domain/sale-tenders.ts` are the single testable allocation contract. They are pure calculations, **not** permission to save. All totals must be recomputed and validated in the database with integer arithmetic and authenticated ownership checks.
