"use server";

import { isUuid } from "@/domain/ids";
import { createClient } from "@/lib/supabase/server";

export type CustomerPaymentState = {
  message: string;
  saved: boolean;
  receiptNumber?: string;
  owing?: number;
};

const failed = (message: string): CustomerPaymentState => ({
  message, saved: false,
});

/** Records a tenant customer debt payment through the atomic, idempotent DB RPC.
 * The server rechecks the signed-in owner and tenant before calling the RPC;
 * the database independently checks them again under lock.
 */
export async function recordBusinessCustomerPayment(
  _previous: CustomerPaymentState,
  form: FormData,
): Promise<CustomerPaymentState> {
  const businessId = String(form.get("business_id") ?? "");
  const customerId = String(form.get("customer_id") ?? "");
  const requestId = String(form.get("request_id") ?? "");
  const businessDate = String(form.get("business_date") ?? "");
  const rawAmount = String(form.get("amount") ?? "");
  const method = String(form.get("method") ?? "");

  if (!isUuid(businessId) || !isUuid(customerId) || !isUuid(requestId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return failed("The payment form expired. Reload this customer account.");
  }
  if (!/^\d+$/.test(rawAmount) ||
      !Number.isSafeInteger(Number(rawAmount)) ||
      Number(rawAmount) <= 0 || Number(rawAmount) > 2147483647) {
    return failed("Enter a valid whole-naira payment greater than zero.");
  }
  if (!["cash", "transfer", "pos"].includes(method)) {
    return failed("Choose cash, transfer or POS.");
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return failed("Sign in again as this depot's owner.");

  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  if (listError || !businesses?.some((item) =>
    item.business_id === businessId &&
    item.member_kind === "owner" &&
    item.business_status === "active"
  )) {
    return failed("This active depot is not available to your owner account.");
  }

  const customer = await supabase.from("customers")
    .select("id,business_id")
    .eq("id", customerId).eq("business_id", businessId)
    .is("archived_at", null).maybeSingle();
  if (customer.error || customer.data?.business_id !== businessId) {
    return failed("This customer does not belong to the selected depot.");
  }

  const { data, error } = await supabase.rpc("record_business_customer_payment", {
    p_business_id: businessId,
    p_request_id: requestId,
    p_customer_id: customerId,
    p_amount: Number(rawAmount),
    p_business_date: businessDate,
    p_method: method,
  });

  if (error || !data || typeof data !== "object" || Array.isArray(data) ||
      data.businessId !== businessId || data.customerId !== customerId ||
      data.requestId !== requestId ||
      typeof data.paymentId !== "string" ||
      typeof data.owing !== "number" ||
      typeof data.receiptNumber !== "string") {
    return failed(
      "The payment was not confirmed. Refresh the account and check the balance before trying again.",
    );
  }

  return {
    message: "Payment recorded successfully.",
    saved: true,
    receiptNumber: data.receiptNumber,
    owing: data.owing,
  };
}
