import { updateActiveSale, type SaleDrafts } from "./sale-drafts.ts";
import type { SaleDraft } from "./sale-builder.ts";

/**
 * A Review response must only advance the EXACT payment and empties that
 * initiated the request. Another tab or a pending amount edit may have
 * changed the stored draft while the server was checking prices and debt.
 * Do not silently attach a refreshed snapshot to different money/returns.
 */
export function transitionSaleToReview(
  current: SaleDrafts,
  expectedId: string | null,
  expectedDraft: SaleDraft,
  reviewed: Pick<SaleDraft, "lines" | "businessDate">,
  newId: string,
): SaleDrafts {
  const stored = current.active?.draft;
  const original = expectedDraft;
  if (!stored || !current.active || current.active.id !== expectedId ||
      stored.step !== "payment" ||
      stored.customerId !== original.customerId ||
      stored.paid !== original.paid ||
      stored.oldDebtPaid !== original.oldDebtPaid ||
      stored.paymentMode !== original.paymentMode ||
      stored.paymentMethod !== original.paymentMethod ||
      stored.splitCash !== original.splitCash ||
      stored.splitTransfer !== original.splitTransfer ||
      stored.splitCashToSale !== original.splitCashToSale ||
      JSON.stringify(stored.multiMethods) !== JSON.stringify(original.multiMethods) ||
      JSON.stringify(stored.multiReceived) !== JSON.stringify(original.multiReceived) ||
      JSON.stringify(stored.multiOldDebt) !== JSON.stringify(original.multiOldDebt) ||
      stored.businessDate !== original.businessDate ||
      JSON.stringify(stored.lines) !== JSON.stringify(original.lines) ||
      JSON.stringify(stored.emptiesV2) !== JSON.stringify(original.emptiesV2)) {
    throw new Error(
      "This sale changed while Review was checking. Your unfinished sale is safe. Check the payment and tap Review again.",
    );
  }
  return updateActiveSale(current, expectedId, {
    lines: reviewed.lines,
    businessDate: reviewed.businessDate,
    step: "review",
  }, newId);
}
