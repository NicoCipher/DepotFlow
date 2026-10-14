/**
 * Saved at transaction time, never reconstructed from live customer balances.
 * Null on receipts created before account statements were introduced.
 */
export type AccountReceipt = {
  bd: number;
  saleTotal: number;
  paidSale: number;
  paidOld: number;
  collected: number;
  cd: number;
  debtPaymentReference: string | null;
};

export function readAccountReceipt(value: unknown): AccountReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Partial<AccountReceipt>;
  const amounts = [data.bd, data.saleTotal, data.paidSale, data.paidOld, data.collected, data.cd];
  if (amounts.some((n) => !Number.isSafeInteger(n) || (n as number) < 0)) return null;
  const [bd, saleTotal, paidSale, paidOld, collected, cd] = amounts as number[];
  if (paidSale > saleTotal || paidOld > bd) return null;
  if (!Number.isSafeInteger(bd + saleTotal) || !Number.isSafeInteger(paidSale + paidOld)) return null;
  if (collected !== paidSale + paidOld || cd !== bd + saleTotal - collected) return null;
  if (data.debtPaymentReference != null &&
    (typeof data.debtPaymentReference !== "string" || data.debtPaymentReference.length > 40))
    return null;
  return {
    bd, saleTotal, paidSale, paidOld, collected, cd,
    debtPaymentReference: data.debtPaymentReference ?? null,
  };
}
