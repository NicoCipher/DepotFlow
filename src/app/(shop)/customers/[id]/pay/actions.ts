"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/auth/owner";
import { isCustomerId } from "@/domain/customers";
import { paymentSaveError, validatePaymentAmount, type PaymentError } from "@/domain/payments";
import { validateBusinessDate } from "@/domain/stock-count";

export type RecordPaymentState = {
  amount: string;
  businessDate: string;
  method: string;
  message?: string;
  field?: PaymentError["field"];
  retryable?: boolean;
};

export async function recordPayment(
  customerId: string,
  requestId: string,
  _previous: RecordPaymentState,
  form: FormData,
): Promise<RecordPaymentState> {
  const amount = String(form.get("amount") ?? "");
  const businessDate = String(form.get("businessDate") ?? "");
  const method = String(form.get("method") ?? "");
  if (
    !isCustomerId(customerId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  )
    return { amount, businessDate, method, message: "Please reopen Record Payment." };
  let validAmount: number;
  let validDate: string;
  try {
    validAmount = validatePaymentAmount(amount);
  } catch {
    return { amount, businessDate, method, field: "amount", message: "Enter a whole payment amount greater than zero." };
  }
  try {
    validDate = validateBusinessDate(businessDate);
  } catch {
    return { amount, businessDate, method, field: "businessDate", message: "Choose a valid business date." };
  }
  if (!["cash", "transfer", "pos"].includes(method))
    return { amount, businessDate, method, field: "method", message: "Choose how the customer paid." };
  let session: Awaited<ReturnType<typeof ownerSession>>;
  try {
    session = await ownerSession();
  } catch {
    return { amount, businessDate, method, ...paymentSaveError() };
  }
  if (!session.allowed || !session.user)
    return { amount, businessDate, method, ...paymentSaveError("42501") };
  const { supabase } = session;
  try {
    const { error } = await supabase.rpc("record_payment", {
      p_request_id: requestId,
      p_customer_id: customerId,
      p_amount: validAmount,
      p_business_date: validDate,
      p_method: method,
    });
    if (error) return { amount, businessDate, method, ...paymentSaveError(error.code, error.message) };
  } catch {
    return { amount, businessDate, method, ...paymentSaveError() };
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/receipts/payment/${requestId}?saved=1`);
}
