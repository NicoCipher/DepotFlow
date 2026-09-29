"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/auth/owner";
import { isCustomerId } from "@/domain/customers";
import {
  openingSaveError,
  validateOpeningBalances,
  type OpeningState,
} from "@/domain/opening-balances";
export async function recordOpeningBalances(
  customerId: string,
  requestId: string,
  _state: OpeningState,
  form: FormData,
): Promise<OpeningState> {
  if (!isCustomerId(customerId) || !isCustomerId(requestId))
    return { message: "Reopen Opening Balances to continue." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("balances") ?? ""));
  } catch {
    return { message: "Check your entries and try again." };
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const checked = validateOpeningBalances(raw, today);
  if (!checked.values)
    return { message: "Check the highlighted fields.", errors: checked.errors };
  const values = checked.values;
  try {
    const session = await ownerSession();
    if (!session.allowed || !session.user) return openingSaveError("42501");
    const { error } = await session.supabase.rpc("record_opening_balances", {
      p_request_id: requestId,
      p_customer_id: customerId,
      p_amount: values.amount,
      p_business_date: values.businessDate,
      p_note: values.note,
      p_crates: values.crates,
      p_bottles: values.bottles,
    });
    if (error) return openingSaveError(error.code, error.message);
  } catch {
    return openingSaveError();
  }
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/customers/${customerId}/opening-balances`);
  revalidatePath("/customers");
  revalidatePath("/");
  revalidatePath("/activity");
  redirect(`/customers/${customerId}/opening-balances?saved=1`);
}
