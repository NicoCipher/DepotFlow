"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import {
  isCustomerId,
  validateCustomer,
  type CustomerFormState,
  type CustomerValues,
} from "@/domain/customers";

async function save(
  id: string,
  editing: boolean,
  formData: FormData,
  returnToSale = false,
): Promise<CustomerFormState> {
  const supabase = await requireOwner();
  const values: CustomerValues = {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    business_name: String(formData.get("business_name") ?? ""),
    address: String(formData.get("address") ?? ""),
  };
  const checked = validateCustomer(values);
  if (!checked.valid)
    return {
      values,
      errors: checked.errors,
      message: "Check the details below.",
    };
  if (!isCustomerId(id))
    return {
      values,
      errors: {},
      message: "Please reopen this form and try again.",
    };
  try {
    let savedId = id;
    if (editing) {
      const result = await supabase
        .from("customers")
        .update(checked.data)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (result.error || !result.data) {
        return {
          values,
          errors: {},
          message: "Could not save the customer. Your details are still here. Please try again.",
        };
      }
    } else {
      // The form ID is an immutable REQUEST token, not the customer PK.
      // This removes the original shop's ability to probe a foreign PK.
      // The verified legacy-only RPC generates the actual customer ID in
      // PostgreSQL, returning the same record after a lost-response retry.
      const result = await supabase.rpc("create_legacy_customer", {
        p_request_id: id,
        p_name: checked.data.name,
        p_phone: checked.data.phone,
        p_business_name: checked.data.business_name,
        p_address: checked.data.address,
      });
      if (result.error || !result.data ||
        typeof result.data !== "object" || Array.isArray(result.data) ||
        typeof result.data.customerId !== "string" ||
        !isCustomerId(result.data.customerId) ||
        result.data.requestId !== id) {
        return {
          values,
          errors: {},
          message: "Could not confirm this customer. Check the customer list before retrying.",
        };
      }
      savedId = result.data.customerId;
    }

    revalidatePath("/customers");
    revalidatePath(`/customers/${savedId}`);
    if (returnToSale && !editing)
      return { values, errors: {}, createdId: savedId };
    redirect(`/customers/${savedId}?saved=${editing ? "updated" : "added"}`);
  } catch {
    return {
      values,
      errors: {},
      message:
        "Could not connect. Your details are still here. Please try again.",
    };
  }
  // Errors above return form state. Successful redirects must happen
  // after the try/catch so Next.js's redirect exception is never caught.
}

export async function addCustomer(
  id: string,
  _previous: CustomerFormState,
  formData: FormData,
) {
  return save(id, false, formData);
}
export async function editCustomer(
  id: string,
  _previous: CustomerFormState,
  formData: FormData,
) {
  return save(id, true, formData);
}

export async function addCustomerForSale(
  id: string,
  _previous: CustomerFormState,
  formData: FormData,
) {
  return save(id, false, formData, true);
}

async function setArchived(id: string, archived: boolean) {
  const supabase = await requireOwner();
  if (!isCustomerId(id)) redirect("/customers");
  const { error } = await supabase
    .from("customers")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error)
    redirect(`/customers/${id}/edit?saved=${archived ? "archive" : "restore"}-failed`);
  revalidatePath("/customers");
  revalidatePath("/customers/archived");
  revalidatePath(`/customers/${id}`);
  revalidatePath(`/customers/${id}/edit`);
  redirect(`/customers/${id}?saved=${archived ? "archived" : "restored"}`);
}

export async function archiveCustomer(id: string) {
  return setArchived(id, true);
}

export async function restoreCustomer(id: string) {
  return setArchived(id, false);
}


async function setCustomerEmptiesTerms(id: string, depositRequired: boolean) {
  const supabase = await requireOwner();
  if (!isCustomerId(id)) redirect("/customers");
  const { data, error } = await supabase
    .from("customers")
    .update({ empties_deposit_required: depositRequired })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data)
    redirect(`/customers/${id}/edit?saved=empties-terms-failed`);
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath(`/customers/${id}/edit`);
  redirect(`/customers/${id}/edit?saved=empties-terms`);
}

export async function allowCustomerToOweEmpties(id: string) {
  return setCustomerEmptiesTerms(id, false);
}

export async function requireCustomerEmptiesDeposit(id: string) {
  return setCustomerEmptiesTerms(id, true);
}
