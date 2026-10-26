/** Explain every reason the final Review confirmation cannot advance.
 * This is navigation guidance only. Server-side save validation is authoritative.
 */
export type ReviewConfirmAction =
  | "check_prices" | "edit_date" | "edit_drinks"
  | "edit_empties" | "check_balance" | "edit_payment";

export type ReviewConfirmIssue = {
  message: string;
  action: ReviewConfirmAction;
};

export function reviewConfirmationIssue(input: {
  ready: boolean;
  checkError: string;
  businessDate: string;
  reviewTotal: number | undefined;
  hasEmptiesReview: boolean;
  emptiesNeedConfirmation: boolean;
  emptiesUnmatched: boolean;
  paid: number;
  debtChecking: boolean;
  debtErrorMessage: string;
  oldDebtInputError: string | null;
  hasPaymentBreakdown: boolean;
  collectNow: number | null;
  paymentMethod: string;
}): ReviewConfirmIssue | null {
  if (!input.ready)
    return {
      message: input.checkError || "Checking current prices and stock. If this takes too long, try again.",
      action: "check_prices",
    };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate))
    return { message: "Choose a sale date before continuing.", action: "edit_date" };
  if (input.reviewTotal === undefined)
    return { message: "Some drink prices or quantities need checking.", action: "edit_drinks" };
  if (!input.hasEmptiesReview || input.emptiesNeedConfirmation || input.emptiesUnmatched)
    return { message: "Confirm the empty crates and bottles before continuing.", action: "edit_empties" };
  if (!Number.isSafeInteger(input.paid) || input.paid < 0 || input.paid > input.reviewTotal)
    return { message: "Check the amount paid toward today's sale.", action: "edit_payment" };
  if (input.debtErrorMessage || input.debtChecking)
    return {
      message: input.debtErrorMessage || "Checking the customer's current balance before saving.",
      action: "check_balance",
    };
  if (input.oldDebtInputError)
    return { message: input.oldDebtInputError, action: "edit_payment" };
  if (!input.hasPaymentBreakdown)
    return { message: "Enter or correct the payment amounts before saving.", action: "edit_payment" };
  if (input.collectNow !== null && input.collectNow > 0 &&
      !["cash", "transfer", "pos"].includes(input.paymentMethod))
    return { message: "Choose Cash, Transfer or POS for this payment.", action: "edit_payment" };
  return null;
}
