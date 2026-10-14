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
