import { formatNaira } from "./products.ts";
import { allocateSplitTender } from "./sale-tenders.ts";

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

/** If the old-debt input is hidden because the verified balance is zero,
 * any invalid/stale entered amount still needs an accessible Clear action.
 */
export function needsClearHiddenOldDebtPayment(oldDebtPaid: string): boolean {
  return Number(oldDebtPaid) > 0 || debtPaymentInputError(oldDebtPaid, 0) !== null;
}

/** Tell the operator why Review cannot proceed, in the order to fix it.
 * Never disable Review silently: its action can reveal and focus this issue.
 */
export type PaymentReviewIssue = {
  message: string;
  target: "sale-paid" | "sale-old-debt-paid" | "sale-previous-debt" | "sale-method" | "sale-split-payment";
};
export function paymentReviewIssue(input: {
  saleTotal: number | undefined;
  paymentInputError: string;
  oldDebtInputError: string | null;
  /** Null while unverified; zero hides the old-debt amount input. */
  oldDebtAmount: number | null;
  /** Amount applied to previous debt, never the current sale payment. */
  oldDebtPaid: string;
  debtChecking: boolean;
  debtErrorMessage: string;
  breakdown: SalePaymentTotals | null;
  paymentMethod: string;
  salePaid?: string;
  paymentMode?: "single" | "split";
  splitCash?: string;
  splitTransfer?: string;
  splitCashToSale?: string;
  splitEnabled?: boolean;
}): PaymentReviewIssue | null {
  if (input.saleTotal === undefined)
    return { message: "Check the drinks and amounts before reviewing this sale.", target: "sale-paid" };
  if (input.paymentInputError)
    return { message: input.paymentInputError, target: "sale-paid" };
  // An independent balance preview must not trap an otherwise valid sale.
  // Review makes a fresh, authenticated server-side balance check anyway.
  // Only a real payment toward OLD debt needs the preview first.
  const paysOldDebt = /^\\d+$/.test(input.oldDebtPaid) && Number(input.oldDebtPaid) > 0;
  if (paysOldDebt && input.debtErrorMessage)
    return { message: "The previous balance needs checking. Use Try again above.", target: "sale-previous-debt" };
  if (paysOldDebt && (input.debtChecking || input.oldDebtAmount === null))
    return { message: "Checking the customer’s previous balance. Please wait or use Try again.", target: "sale-previous-debt" };
  if (input.oldDebtInputError)
    return {
      message: input.oldDebtInputError,
      // When debt has reached zero, the amount input is deliberately hidden;
      // the always-rendered section offers the Clear old-debt payment action.
      target: (input.oldDebtAmount ?? 0) > 0 ? "sale-old-debt-paid" : "sale-previous-debt",
    };
  if (!input.breakdown)
    return { message: "Check today's payment and previous-debt amounts.", target: "sale-previous-debt" };
  if (input.paymentMode === "split") {
    if (!input.splitEnabled)
      return { message: "Split payment is not available yet. Choose one method.", target: "sale-method" };
    try {
      allocateSplitTender(Number(input.salePaid ?? "0"), Number(input.oldDebtPaid), {
        cash: input.splitCash ?? "0", transfer: input.splitTransfer ?? "0",
        ...(input.splitCashToSale ? { cashToSale: input.splitCashToSale } : {}),
      });
      return null;
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Check Cash and Transfer amounts.",
        target: "sale-split-payment",
      };
    }
  }
  if (input.breakdown.collectNow > 0 && !["cash", "transfer", "pos"].includes(input.paymentMethod))
    return {
      message: `Choose how the customer is paying ${formatNaira(input.breakdown.collectNow)}: Cash, Transfer or POS.`,
      target: "sale-method",
    };
  return null;
}
