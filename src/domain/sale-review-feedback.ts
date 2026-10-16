/** Keep normal checkout progress out of red error alerts. */
export const saleReviewCheckingMessage = "Checking current prices, stock and customer balance…";
export const saleReviewOpeningMessage = "Checks complete. Opening Review…";

export function isSaleReviewProgressMessage(message: string): boolean {
  return message === saleReviewCheckingMessage || message === saleReviewOpeningMessage;
}
