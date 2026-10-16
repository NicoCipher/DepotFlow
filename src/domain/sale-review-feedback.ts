/** Keep normal checkout progress out of red error alerts. */
export const saleReviewCheckingMessage = "Checking current prices, stock and customer balance…";
export const saleReviewOpeningMessage = "Checks complete. Opening Review…";

export function isSaleReviewProgressMessage(message: string): boolean {
  return message === saleReviewCheckingMessage || message === saleReviewOpeningMessage;
}

export type SaleReviewFeedbackContext = {
  activeId: string | null;
  customerId: string | null;
};

/** A progress message belongs only to the draft/customer that requested it. */
export function contextualSaleReviewMessage(
  message: string,
  started: SaleReviewFeedbackContext,
  current: SaleReviewFeedbackContext & { step: string },
): string {
  if (!isSaleReviewProgressMessage(message)) return message;
  return current.step === "payment" &&
    started.activeId !== null &&
    started.activeId === current.activeId &&
    started.customerId === current.customerId ? message : "";
}

/** A stale response must never erase a newer Review attempt or a real error. */
export function clearOwnSaleReviewProgress(
  message: string, requestId: number, latestRequestId: number,
): string {
  return requestId === latestRequestId && isSaleReviewProgressMessage(message)
    ? "" : message;
}
