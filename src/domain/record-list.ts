import type { CustomerRecord } from "./records.ts";
import { recordStatus } from "./records.ts";

// History is a summary of immutable transactions, not a recalculation of debt.
export function recordListView(item: CustomerRecord) {
  const sale = item.kind === "sale";
  const payment = item.kind === "payment";
  const empties = item.kind === "empties";
  const voided = item.status === "voided";
  const linkedPaymentVoided = sale && item.linked_payment_voided;
  const combined = sale && item.old_debt_paid > 0 && !voided && !linkedPaymentVoided;
  const heldOnly = empties && item.crates === 0 && item.bottles === 0 &&
    (item.held_crates > 0 || item.held_bottles > 0);
  const paymentDuringSale = payment && Boolean(item.linked_sale_id);
  const label = linkedPaymentVoided ? "Sale · payment voided"
    : combined ? "Sale + debt"
    : sale ? "Sale"
    : payment ? "Debt payment"
    : heldOnly ? "Held empties collected"
    : empties ? "Empties"
    : "Opening balance";

  const money = sale ? (combined ? item.checkout_received : item.sale_total)
    : payment ? item.received
    : item.kind === "opening" ? item.remaining
    : null;
  const moneyLabel = combined ? "Collected" : sale ? "Sale value"
    : payment ? (voided ? "Voided payment" : "Received") : "Starting debt";

  const status = voided ? "Voided"
    : linkedPaymentVoided ? "Payment voided"
    : combined && item.checkout_balance === 0 ? "Settled at checkout"
    : combined && item.checkout_balance !== null ? "Balance owing"
    : combined ? "Checkout saved"
    : item.kind === "sale" && item.status === "unpaid" ? "Unpaid when sold"
    : item.kind === "sale" && item.status === "partial" ? "Partly paid when sold"
    : item.kind === "sale" ? recordStatus(item.kind, item.status)
    : payment ? "Received"
    : "Recorded";
  const tone = voided || linkedPaymentVoided ? "danger"
    : combined && item.checkout_balance !== null && item.checkout_balance > 0 ? "warning"
    : sale && item.remaining > 0 ? "warning"
    : payment || (sale && item.status === "paid") || (combined && item.checkout_balance === 0) ? "success"
    : "neutral";
  return { label, money, moneyLabel, status, tone, combined, heldOnly, paymentDuringSale,
    linkedPaymentVoided, sale, payment, empties, voided } as const;
}
