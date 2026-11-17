"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/domain/ids";
import { validateCustomer } from "@/domain/customers";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

export type NewBusinessCustomerState = { message: string; saved: boolean };
const notSaved = (message: string): NewBusinessCustomerState => ({ message, saved: false });

/** Add a customer to this tenant. Setup businesses are checked against the
 * guided assortment; active businesses are checked against live membership.
 * The database RPC independently enforces the status, gates and tenant scope.
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

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return notSaved("Sign in again as this depot's owner.");
  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  const business = businesses?.find((item) =>
    item.business_id === businessId &&
    item.member_kind === "owner" &&
    ["setup", "active"].includes(item.business_status)
  );
  if (listError || !business) {
    return notSaved("This depot is not available to your owner account.");
  }
  if (business.business_status === "setup") {
    const owner = await loadOwnerAssortment(businessId);
    if (owner.state !== "ready") {
      return notSaved("This depot's customer setup is not available yet.");
    }
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

  const { data, error } = await supabase.rpc("register_business_customer", {
    p_business_id: businessId,
    p_request_id: requestId,
    p_name: checked.data.name,
    p_phone: checked.data.phone,
    p_customer_business_name: checked.data.business_name,
    p_address: checked.data.address,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data) ||
      data.businessId !== businessId || data.requestId !== requestId ||
      typeof data.customerId !== "string" || !isUuid(data.customerId) ||
      data.canOperate !== false) {
    return notSaved("Could not confirm this customer. Check your depot's customer list before trying again.");
  }
  redirect(`/businesses/${businessId}/customers?added=1&customer=${data.customerId}`);
}
