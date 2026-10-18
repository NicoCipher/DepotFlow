"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/domain/ids";
import { sameCustomerDetails, validateCustomer } from "@/domain/customers";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

export type NewBusinessCustomerState = {
  message: string;
  saved: boolean;
};

const notSaved = (message: string): NewBusinessCustomerState => ({
  message,
  saved: false,
});

/** Creates only a customer identity, not an opening debt, deposit, sale,
 * or customer-owed empties. Existing opening balances have a SEPARATE
 * verified atomic RPC and must not be faked with direct table writes.
 */
export async function addBusinessCustomer(
  _previous: NewBusinessCustomerState,
  form: FormData,
): Promise<NewBusinessCustomerState> {
  const businessId = String(form.get("business_id") ?? "");
  const customerId = String(form.get("customer_id") ?? "");
  if (!isUuid(businessId) || !isUuid(customerId)) {
    return notSaved("The customer request is invalid. Reload this depot's page.");
  }

  // Fresh owner check on every POST. A guessed business URL or a posted
  // business ID is never accepted as evidence of permission.
  const owner = await loadOwnerAssortment(businessId);
  if (owner.state !== "ready") {
    return notSaved("This depot's customer setup is not available yet.");
  }

  const checked = validateCustomer({
    name: String(form.get("name") ?? ""),
    phone: String(form.get("phone") ?? ""),
    business_name: String(form.get("business_name") ?? ""),
    address: String(form.get("address") ?? ""),
  });
  if (!checked.valid) {
    return notSaved(Object.values(checked.errors)[0] ?? "Check the customer details.");
  }

  const supabase = await createClient();
  const inserted = await supabase.from("customers").insert({
    id: customerId,
    business_id: businessId,
    ...checked.data,
  }).select("id").maybeSingle();

  if (inserted.error || !inserted.data) {
    // Lost-response retries should succeed ONLY if the SAME customer ID
    // and SAME tenant-scoped details were already saved. Never upsert or
    // silently replace a customer's later edits.
    if (inserted.error?.code !== "23505") {
      return notSaved(
        "Could not confirm this customer. Check your customer list before trying again.",
      );
    }
    const existing = await supabase.from("customers")
      .select("business_id,name,phone,business_name,address")
      .eq("id", customerId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (existing.error || !existing.data ||
      existing.data.business_id !== businessId ||
      !sameCustomerDetails(existing.data, checked.data)) {
      return notSaved(
        "The original request has different details. Check your depot's customer list.",
      );
    }
  }

  redirect(`/businesses/${businessId}/customers?added=1`);
}
