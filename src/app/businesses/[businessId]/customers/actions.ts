"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/domain/ids";
import { validateCustomer } from "@/domain/customers";
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

/** Setup-only customer identity. DB generates the actual ID and atomically
 * remembers the tenant-qualified request UUID for safe retries.
 * No old debt, deposit, empties, receipt or sale is written here.
 */
export async function addBusinessCustomer(
  _previous: NewBusinessCustomerState,
  form: FormData,
): Promise<NewBusinessCustomerState> {
  const businessId = String(form.get("business_id") ?? "");
  const requestId = String(form.get("request_id") ?? "");
  if (!isUuid(businessId) || !isUuid(requestId)) {
    return notSaved("The customer request is invalid. Reload this depot's page.");
  }

  // Verify the active owner's selected SETUP depot on every POST, rather
  // than treating a submitted business ID as ownership evidence.
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
  // The browser cannot choose customer_id. The independently gated DB
  // function generates one, checks owner membership and serializes replay.
  const { data, error } = await supabase.rpc("register_business_customer", {
    p_business_id: businessId,
    p_request_id: requestId,
    p_name: checked.data.name,
    p_phone: checked.data.phone,
    p_customer_business_name: checked.data.business_name,
    p_address: checked.data.address,
  });

  if (
    error || !data || typeof data !== "object" || Array.isArray(data) ||
    data.businessId !== businessId || data.requestId !== requestId ||
    typeof data.customerId !== "string" || !isUuid(data.customerId) ||
    data.canOperate !== false
  ) {
    return notSaved(
      "Could not confirm this customer. Check your depot's customer list before trying again.",
    );
  }

  redirect(`/businesses/${businessId}/customers?added=1`);
}
