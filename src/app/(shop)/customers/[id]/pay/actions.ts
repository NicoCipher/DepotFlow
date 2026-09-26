"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isCustomerId } from "@/domain/customers";
import { validatePaymentAmount } from "@/domain/payments";
import { validateBusinessDate } from "@/domain/stock-count";

export type RecordPaymentState = {
  amount: string;
  businessDate: string;
  message?: string;
};

export async function recordPayment(
  customerId: string,
  requestId: string,
  _previous: RecordPaymentState,
  form: FormData,
): Promise<RecordPaymentState> {
  const supabase = await requireOwner();
  const amount = String(form.get("amount") ?? "");
  const businessDate = String(form.get("businessDate") ?? "");
  if (
    !isCustomerId(customerId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  )
    return { amount, businessDate, message: "Please reopen Record Payment." };
  try {
    const validAmount = validatePaymentAmount(amount);
    const validDate = validateBusinessDate(businessDate);
    const { error } = await supabase.rpc("record_payment", {
      p_request_id: requestId,
      p_customer_id: customerId,
      p_amount: validAmount,
      p_business_date: validDate,
    });
    if (error)
      return {
        amount,
        businessDate,
        message:
          error.code === "22023"
            ? error.message
            : "Could not save payment. You can safely try again.",
      };
  } catch (cause) {
    return {
      amount,
      businessDate,
      message:
        cause instanceof Error ? cause.message : "Check the payment amount.",
    };
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?saved=payment`);
}
