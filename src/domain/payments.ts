import { isSessionExpiredCode } from "./save-errors.ts";
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

export type PaymentError = { field?: "amount" | "businessDate" | "method"; message: string; retryable: boolean };

export function paymentSaveError(code?: string, message?: string): PaymentError {
  if (isSessionExpiredCode(code))
    return { message: "Your session has expired. Sign in again, then check payment history before recording another payment.", retryable: false };
  if (code === "22023") {
    switch (message) {
      case "Payment cannot exceed money owed.":
        return { field: "amount", message: "This payment is more than the customer currently owes. Check Money Owed and enter an amount up to that balance.", retryable: false };
      case "This customer does not owe any money.":
        return { field: "amount", message: "This customer no longer owes money. Check their payment history before trying again.", retryable: false };
      case "Enter a whole payment amount greater than zero.":
        return { field: "amount", message: "Enter a whole payment amount greater than zero.", retryable: false };
      case "Choose a payment method.":
        return { field: "method", message: "Choose how the customer paid.", retryable: false };
      case "Choose a valid business date.":
        return { field: "businessDate", message: "Choose a valid business date.", retryable: false };
      case "Customer no longer exists.":
        return { message: "This customer is no longer available. Return to Customers.", retryable: false };
      case "This payment form was already used with different details.":
        return { message: "This form may have already saved a payment. Check payment history before recording another payment.", retryable: false };
    }
  }
  return { message: "Could not confirm whether the payment saved. Try again with the same details; this form will not record it twice.", retryable: true };
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
