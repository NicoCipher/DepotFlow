/**
 * A timed-out or lost Save response is NOT a new save attempt.
 * "Check Sale" only reconciles the original request ID under the database's
 * advisory lock and permanent non-save fence. It must not depend on today's
 * catalog, product metadata, old-debt preview, or empties checks being online.
 *
 * A normal financial Save still needs every required input to be valid.
 */
export function blockSaleSaveAction(input: {
  pending: boolean;
  saveUncertain: boolean;
  ready: boolean;
  hasBusinessDate: boolean;
  reviewedTotalAvailable: boolean;
  emptiesValid: boolean;
  paidWithinTotal: boolean;
  paymentValid: boolean;
}): boolean {
  if (input.pending) return true;
  if (input.saveUncertain) return false;
  return !input.ready || !input.hasBusinessDate ||
    !input.reviewedTotalAvailable || !input.emptiesValid ||
    !input.paidWithinTotal || !input.paymentValid;
}

/** Keep the Check Sale recovery screen accessible if the customer disappeared
 * from the refreshed catalogue after the original request was submitted. */
export function visibleSaleStep(input: {
  customerAvailable: boolean;
  saveUncertain: boolean;
  draftStep: "customer" | "drinks" | "quantity" | "empties" | "payment" | "review";
}): typeof input.draftStep {
  if (input.customerAvailable || (input.saveUncertain && input.draftStep === "review"))
    return input.draftStep;
  return "customer";
}
