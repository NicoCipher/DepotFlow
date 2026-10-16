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

/**
 * If the cashier enters less Cash + Transfer than the planned collection,
 * offer only explicit, valid ways to reduce the payment allocation.
 * Never infer whether the missing money belonged to today's sale or old debt.
 * These are preview suggestions: no draft changes until the owner taps one.
 */
export type SplitShortfallChoice = {
  appliesTo: "sale" | "oldDebt";
  salePaid: number;
  oldDebtPaid: number;
  saleUnpaid: number;
  oldDebtLeft: number | null;
};

export function splitTenderShortfallChoices(input: {
  saleTotal: number | undefined;
  salePaid: string;
  oldDebt: number | null;
  oldDebtPaid: string;
  cash: string;
  transfer: string;
  cashToSale: string;
}): { received: number; shortfall: number; choices: SplitShortfallChoice[] } | null {
  const { saleTotal, oldDebt, cash, transfer, cashToSale } = input;
  if (saleTotal === undefined) return null;
  const all = [input.salePaid, input.oldDebtPaid, cash, transfer];
  if (all.some((value) => !/^\d+$/.test(value))) return null;
  const [salePaid, oldDebtPaid, cashPaid, transferPaid] = all.map(Number);
  if ([salePaid, oldDebtPaid, cashPaid, transferPaid].some((n) =>
    !Number.isSafeInteger(n) || n < 0 || n > 2147483647
  ) || cashPaid === 0 || transferPaid === 0) return null;
  try {
    salePaymentTotals(saleTotal, salePaid, oldDebt ?? 0, oldDebtPaid);
  } catch {
    return null;
  }
  const expected = salePaid + oldDebtPaid;
  const received = cashPaid + transferPaid;
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(received) ||
      received >= expected || received > 2147483647) return null;
  const shortfall = expected - received;
  const choices: SplitShortfallChoice[] = [];
  function add(appliesTo: SplitShortfallChoice["appliesTo"], nextSale: number, nextOld: number) {
    try {
      allocateSplitTender(nextSale, nextOld, {
        cash, transfer,
        ...(cashToSale !== "" ? { cashToSale } : {}),
      });
      choices.push({
        appliesTo, salePaid: nextSale, oldDebtPaid: nextOld,
        saleUnpaid: saleTotal! - nextSale,
        oldDebtLeft: oldDebt === null ? null : oldDebt - nextOld,
      });
    } catch {
      // Keep custom Cash allocations intact. Offer no invalid shortcut.
    }
  }
  if (shortfall <= salePaid) add("sale", salePaid - shortfall, oldDebtPaid);
  if (oldDebt !== null && shortfall <= oldDebtPaid) add("oldDebt", salePaid, oldDebtPaid - shortfall);
  return choices.length ? { received, shortfall, choices } : null;
}

/**
 * Cash + Transfer records money actually received, not a second copy of a
 * separately entered payment target. Previous debt receives NOTHING unless
 * explicitly allocated by the operator.
 *
 * The UI only synchronizes draft.paid when status is valid. A typed partial/
 * invalid input must never create a made-up payment.
 */
export function splitPaymentFromReceived(input: {
  saleTotal: number | undefined;
  oldDebt: number | null;
  oldDebtPaid: string;
  cash: string;
  transfer: string;
}): {
  received: number | null;
  salePaid: number | null;
  oldDebtPaid: number | null;
  extraForOldDebt: number;
  issue: string | null;
} {
  const { saleTotal, oldDebt } = input;
  const amounts = [input.cash, input.transfer, input.oldDebtPaid];
  const digits = /^\d+$/;
  if (!amounts.every((value) => digits.test(value)))
    return { received: null, salePaid: null, oldDebtPaid: null, extraForOldDebt: 0,
      issue: "Enter valid whole-naira amounts for Cash, Transfer and previous debt." };
  const [cash, transfer, paidOld] = amounts.map(Number);
  if ([cash, transfer, paidOld].some((value) =>
    !Number.isSafeInteger(value) || value < 0 || value > 2147483647
  ) || cash + transfer > 2147483647)
    return { received: null, salePaid: null, oldDebtPaid: null, extraForOldDebt: 0,
      issue: "Check the amounts received." };
  const received = cash + transfer;
  if (saleTotal === undefined)
    return { received, salePaid: null, oldDebtPaid: paidOld, extraForOldDebt: 0,
      issue: "Check today's sale total first." };
  if (paidOld > 0 && oldDebt === null)
    return { received, salePaid: null, oldDebtPaid: paidOld, extraForOldDebt: 0,
      issue: "Wait until the previous debt is verified before paying it." };
  if (oldDebt !== null && paidOld > oldDebt)
    return { received, salePaid: null, oldDebtPaid: paidOld, extraForOldDebt: 0,
      issue: `The previous debt is only ${formatNaira(oldDebt)}.` };
  if (paidOld > received)
    return { received, salePaid: null, oldDebtPaid: paidOld, extraForOldDebt: 0,
      issue: "Payment toward old debt cannot exceed the money received." };
  const salePaid = received - paidOld;
  if (salePaid > saleTotal) {
    const extraForOldDebt = salePaid - saleTotal;
    return { received, salePaid: null, oldDebtPaid: paidOld, extraForOldDebt,
      issue: `${formatNaira(extraForOldDebt)} exceeds today's sale. Choose whether to pay previous debt, or correct the received amounts.` };
  }
  return { received, salePaid, oldDebtPaid: paidOld, extraForOldDebt: 0, issue: null };
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
  splitEntryIssue?: string | null;
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
  if (input.paymentMode === "split" && input.splitEntryIssue)
    return { message: input.splitEntryIssue, target: "sale-split-payment" };
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
