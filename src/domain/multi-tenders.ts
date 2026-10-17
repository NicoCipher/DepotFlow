import { formatNaira } from "./products.ts";
import { MAX_TENDER_NAIRA, parseTenderNaira, type SaleTenderLeg, type SaleTenderMethod } from "./sale-tenders.ts";

/** Stable order for UI, hashing and replay. Never depend on chip tap order. */
export const paymentMethods: readonly SaleTenderMethod[] = ["cash", "transfer", "pos"];

export type MultiMethodAmounts = Record<SaleTenderMethod, string>;
export const emptyMultiAmounts = (): MultiMethodAmounts => ({
  cash: "0", transfer: "0", pos: "0",
});

export type MultiPaymentInput = {
  methods: readonly SaleTenderMethod[];
  received: MultiMethodAmounts;
  towardOldDebt: MultiMethodAmounts;
};

/** Each method is real money received; the operator separately chooses how
 * much of that method pays older debt. No guessed or inferred tender method. */
export function allocateMultiTender(
  salePaid: number,
  oldDebtPaid: number,
  input: MultiPaymentInput,
): SaleTenderLeg[] {
  if (![salePaid, oldDebtPaid].every(n =>
    Number.isSafeInteger(n) && n >= 0 && n <= MAX_TENDER_NAIRA) ||
    salePaid + oldDebtPaid > MAX_TENDER_NAIRA)
    throw new Error("Check the sale and previous-debt payment.");
  if (!Array.isArray(input.methods) || input.methods.length < 2 ||
      input.methods.length > 3 || new Set(input.methods).size !== input.methods.length ||
      input.methods.some(m => !paymentMethods.includes(m)))
    throw new Error("Choose two or three different payment methods.");
  const legs: SaleTenderLeg[] = [];
  for (const method of paymentMethods) {
    if (!input.methods.includes(method)) continue;
    const amount = parseTenderNaira(input.received[method], method);
    const old = parseTenderNaira(input.towardOldDebt[method], method + " toward previous debt");
    if (old > amount)
      throw new Error("Previous-debt payment cannot exceed the amount received through " + method.toUpperCase() + ".");
    if (amount > 0) legs.push({ method, amount, oldDebtAmount: old, saleAmount: amount - old });
  }
  if (legs.length < 2)
    throw new Error("Enter money received through at least two methods, or use one method.");
  const total = legs.reduce((sum, leg) => sum + leg.amount, 0);
  if (!Number.isSafeInteger(total) || total > MAX_TENDER_NAIRA ||
      total !== salePaid + oldDebtPaid)
    throw new Error("Received money must match the amount paid on the sale and previous debt.");
  if (legs.reduce((sum, leg) => sum + leg.oldDebtAmount, 0) !== oldDebtPaid ||
      legs.reduce((sum, leg) => sum + leg.saleAmount, 0) !== salePaid)
    throw new Error("Check which payment methods paid today's sale and previous debt.");
  return legs;
}

export type MultiPaymentPreview = {
  received: number | null;
  salePaid: number | null;
  oldDebtPaid: number | null;
  issue: string | null;
};

/** Derive today's payment from actual received amounts, never a second
 * separately entered planned amount. A partial sale is valid. */
export function multiPaymentFromReceived(input: MultiPaymentInput & {
  saleTotal: number | undefined;
  verifiedOldDebt: number | null;
}): MultiPaymentPreview {
  let totalReceived = 0;
  let paidOld = 0;
  if (!Array.isArray(input.methods) || new Set(input.methods).size !== input.methods.length ||
      input.methods.some(m => !paymentMethods.includes(m)))
    return { received: null, salePaid: null, oldDebtPaid: null, issue: "Choose valid payment methods." };
  try {
    for (const method of input.methods) {
      const amount = parseTenderNaira(input.received[method], method);
      const old = parseTenderNaira(input.towardOldDebt[method], method + " toward previous debt");
      if (old > amount)
        return { received: null, salePaid: null, oldDebtPaid: null,
          issue: "The previous-debt amount for " + method.toUpperCase() + " exceeds what was received." };
      totalReceived += amount;
      paidOld += old;
    }
  } catch (error) {
    return { received: null, salePaid: null, oldDebtPaid: null,
      issue: error instanceof Error ? error.message : "Enter whole-naira amounts." };
  }
  if (totalReceived > MAX_TENDER_NAIRA || paidOld > MAX_TENDER_NAIRA)
    return { received: null, salePaid: null, oldDebtPaid: null, issue: "The amount received is too large." };
  if (input.saleTotal === undefined)
    return { received: totalReceived, salePaid: null, oldDebtPaid: paidOld,
      issue: "Check today's sale total first." };
  if (paidOld > 0 && input.verifiedOldDebt === null)
    return { received: totalReceived, salePaid: null, oldDebtPaid: paidOld,
      issue: "Check the customer's previous debt before paying it." };
  if (input.verifiedOldDebt !== null && paidOld > input.verifiedOldDebt)
    return { received: totalReceived, salePaid: null, oldDebtPaid: paidOld,
      issue: "Previous debt is only " + formatNaira(input.verifiedOldDebt) + "." };
  const salePaid = totalReceived - paidOld;
  if (salePaid > input.saleTotal)
    return { received: totalReceived, salePaid: null, oldDebtPaid: paidOld,
      issue: formatNaira(salePaid - input.saleTotal) +
        " exceeds today's sale. Correct the amounts or explicitly apply money to previous debt." };
  if (input.methods.filter(method => Number(input.received[method]) > 0).length < 2)
    return { received: totalReceived, salePaid, oldDebtPaid: paidOld,
      issue: "Enter two payment amounts, or use one method." };
  return { received: totalReceived, salePaid, oldDebtPaid: paidOld, issue: null };
}

/** Only the selected methods may carry money. A dropped chip never silently
 * writes a hidden value to a receipt. */
export function sanitizedMultiPayment(input: MultiPaymentInput): MultiPaymentInput {
  return {
    methods: [...input.methods],
    received: Object.fromEntries(paymentMethods.map(m =>
      [m, input.methods.includes(m) ? input.received[m] : "0"])) as MultiMethodAmounts,
    towardOldDebt: Object.fromEntries(paymentMethods.map(m =>
      [m, input.methods.includes(m) ? input.towardOldDebt[m] : "0"])) as MultiMethodAmounts,
  };
}
