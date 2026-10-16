import { formatNaira } from "./products.ts";

/**
 * A tender describes real money received via one method. The amounts applied
 * to today's sale and prior debt are separate immutable facts, never inferred
 * later from a customer's changing balance.
 */
export type SaleTenderMethod = "cash" | "transfer" | "pos";

export type SaleTenderLeg = {
  method: SaleTenderMethod;
  saleAmount: number;
  oldDebtAmount: number;
  amount: number;
};

export type SplitTenderInput = {
  cash: string;
  transfer: string;
  /**
   * Optional explicit cash allocation to today's sale. When absent, cash is
   * applied to the sale first, with the remainder to previously owed debt.
   * Operators may change this allocation when both balances are being paid.
   */
  cashToSale?: string;
};

export const MAX_TENDER_NAIRA = 2147483647;

export function parseTenderNaira(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Enter a whole naira amount for ${name}, starting at 0.`);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_TENDER_NAIRA) {
    throw new Error(`Check the ${name} amount.`);
  }
  return amount;
}

function checkedAmount(amount: number, name: string): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_TENDER_NAIRA)
    throw new Error(`Check the amount for ${name}.`);
  return amount;
}

/**
 * Produce exactly two separately auditable tender legs. Both must actually be
 * used; a zero leg belongs in the existing one-method checkout instead.
 *
 * Money allocation is explicit: cashSale + transferSale = salePaid, and
 * cashOld + transferOld = oldDebtPaid. No overpayment or rounding.
 */
export function allocateSplitTender(
  salePaid: number,
  oldDebtPaid: number,
  input: SplitTenderInput,
): [SaleTenderLeg, SaleTenderLeg] {
  checkedAmount(salePaid, "today's sale");
  checkedAmount(oldDebtPaid, "previous debt");
  const expected = salePaid + oldDebtPaid;
  if (!Number.isSafeInteger(expected) || expected > MAX_TENDER_NAIRA)
    throw new Error("The total collected is too large.");

  const cash = parseTenderNaira(input.cash, "cash");
  const transfer = parseTenderNaira(input.transfer, "transfer");
  if (cash === 0 || transfer === 0)
    throw new Error("Use one payment method when only Cash or Transfer was received.");
  if (cash + transfer !== expected)
    throw new Error(`Cash + Transfer must equal ${formatNaira(expected)} collected.`);

  const cashToSale =
    input.cashToSale === undefined
      ? Math.min(cash, salePaid)
      : parseTenderNaira(input.cashToSale, "cash toward today's sale");

  const cashToOld = cash - cashToSale;
  const transferToSale = salePaid - cashToSale;
  const transferToOld = oldDebtPaid - cashToOld;
  if (cashToOld < 0 || transferToSale < 0 || transferToOld < 0)
    throw new Error("Check how Cash is allocated between today's sale and previous debt.");

  const cashLeg: SaleTenderLeg = {
    method: "cash", saleAmount: cashToSale, oldDebtAmount: cashToOld, amount: cash,
  };
  const transferLeg: SaleTenderLeg = {
    method: "transfer", saleAmount: transferToSale, oldDebtAmount: transferToOld, amount: transfer,
  };
  return [cashLeg, transferLeg];
}

/** Validate the exact immutable ledger facts, independent of the UI. */
export function validateTenderLegs(
  legs: readonly SaleTenderLeg[],
  salePaid: number,
  oldDebtPaid: number,
): void {
  checkedAmount(salePaid, "today's sale");
  checkedAmount(oldDebtPaid, "previous debt");
  if (salePaid + oldDebtPaid > MAX_TENDER_NAIRA)
    throw new Error("The total collected is too large.");
  if (legs.length < 1 || legs.length > 2)
    throw new Error("Use one or two payment methods.");
  const seen = new Set<SaleTenderMethod>();
  if (legs.length === 2 && legs[0].method === legs[1].method)
    throw new Error("Each payment method must be valid and appear only once.");
  if (legs.length === 2 &&
      (legs[0].method !== "cash" && legs[1].method !== "cash" ||
       legs[0].method !== "transfer" && legs[1].method !== "transfer"))
    throw new Error("Two payment methods must be Cash and Transfer.");
  let paidSale = 0;
  let paidOld = 0;
  let collected = 0;
  for (const leg of legs) {
    if (!["cash", "transfer", "pos"].includes(leg.method) || seen.has(leg.method))
      throw new Error("Each payment method must be valid and appear only once.");
    seen.add(leg.method);
    checkedAmount(leg.saleAmount, "sale tender");
    checkedAmount(leg.oldDebtAmount, "old-debt tender");
    checkedAmount(leg.amount, "received tender");
    if (leg.amount <= 0 || leg.saleAmount + leg.oldDebtAmount !== leg.amount)
      throw new Error("Every payment method must match its sale and debt allocations.");
    paidSale += leg.saleAmount;
    paidOld += leg.oldDebtAmount;
    collected += leg.amount;
  }
  if (paidSale !== salePaid || paidOld !== oldDebtPaid ||
      collected !== salePaid + oldDebtPaid)
    throw new Error("Tender amounts do not match what was collected.");
}
