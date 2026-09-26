export type PaymentSummary = {
  id: string;
  customerId: string;
  businessDate: string;
  createdAt: string;
  amount: number;
  owedAfter: number;
};

/**
 * Format-level check only: whole positive number, no decimals, within range.
 * Zero debt and overpayment are rejected by the database against the current,
 * locked balance, not against a value read before this form was submitted.
 */
export function validatePaymentAmount(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed))
    throw new Error("Enter a whole payment amount greater than zero.");
  const amount = Number(trimmed);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647)
    throw new Error("Enter a whole payment amount greater than zero.");
  return amount;
}

export function newestPayments(
  payments: PaymentSummary[],
): PaymentSummary[] {
  return [...payments].sort((a, b) => {
    const date = b.businessDate.localeCompare(a.businessDate);
    return (
      date ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id)
    );
  });
}

export function paymentHistoryState(payments: PaymentSummary[]) {
  return { empty: payments.length === 0, payments: newestPayments(payments) };
}
