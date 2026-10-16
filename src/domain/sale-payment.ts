import { formatNaira } from "./products.ts";

export type SalePaymentTotals = {
  oldDebtRemaining: number;
  saleRemaining: number;
  collectNow: number;
  totalOwedAfter: number;
};

/** Today's sale and an older customer debt stay separate in the ledger. */
export function salePaymentTotals(
  saleTotal: number,
  salePaid: number,
  oldDebt: number,
  oldDebtPaid: number,
): SalePaymentTotals {
  for (const amount of [saleTotal, salePaid, oldDebt, oldDebtPaid]) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2147483647)
      throw new Error("Check the payment amounts.");
  }
  if (salePaid > saleTotal)
    throw new Error("Payment for this sale cannot exceed its total.");
  if (oldDebtPaid > oldDebt)
    throw new Error(`Payment toward previous debt cannot exceed ${formatNaira(oldDebt)}.`);
  const oldDebtRemaining = oldDebt - oldDebtPaid;
  const saleRemaining = saleTotal - salePaid;
  const collectNow = salePaid + oldDebtPaid;
  const totalOwedAfter = oldDebtRemaining + saleRemaining;
  if (!Number.isSafeInteger(collectNow) || collectNow > 2147483647 ||
      !Number.isSafeInteger(totalOwedAfter) || totalOwedAfter > 2147483647)
    throw new Error("The combined balance is too large.");
  return { oldDebtRemaining, saleRemaining, collectNow, totalOwedAfter };
}

export function debtPaymentInputError(input: string, currentDebt: number | null): string | null {
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) > 2147483647)
    return "Enter a whole amount toward previous debt, starting at 0.";
  if (Number(input) > 0 && currentDebt === null)
    return "Check the customer's existing balance before recording this payment.";
  if (currentDebt !== null && Number(input) > currentDebt)
    return `Previous debt is ${formatNaira(currentDebt)}. Enter that amount or less.`;
  return null;
}

/** Tell the operator why Review cannot proceed, in the order to fix it.
 * Never disable Review silently: its action can reveal and focus this issue.
 */
export type PaymentReviewIssue = {
  message: string;
  target: "sale-paid" | "sale-old-debt-paid" | "sale-previous-debt" | "sale-method";
};
export function paymentReviewIssue(input: {
  saleTotal: number | undefined;
  paymentInputError: string;
  oldDebtInputError: string | null;
  debtChecking: boolean;
  debtErrorMessage: string;
  breakdown: SalePaymentTotals | null;
  paymentMethod: string;
}): PaymentReviewIssue | null {
  if (input.saleTotal === undefined)
    return { message: "Check the drinks and amounts before reviewing this sale.", target: "sale-paid" };
  if (input.paymentInputError)
    return { message: input.paymentInputError, target: "sale-paid" };
  if (input.oldDebtInputError)
    return { message: input.oldDebtInputError, target: "sale-old-debt-paid" };
  if (input.debtErrorMessage)
    return { message: "The previous balance needs checking. Use Try again above.", target: "sale-previous-debt" };
  if (input.debtChecking || !input.breakdown)
    return { message: "Checking the customer’s previous balance. Please wait or use Try again.", target: "sale-previous-debt" };
  if (input.breakdown.collectNow > 0 && !["cash", "transfer", "pos"].includes(input.paymentMethod))
    return {
      message: `Choose how the customer is paying ${formatNaira(input.breakdown.collectNow)}: Cash, Transfer or POS.`,
      target: "sale-method",
    };
  return null;
}
