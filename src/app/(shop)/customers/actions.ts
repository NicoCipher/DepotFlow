"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import {
  isCustomerId,
  sameCustomerDetails,
  validateCustomer,
  type CustomerFormState,
  type CustomerValues,
} from "@/domain/customers";

async function save(
  id: string,
  editing: boolean,
  formData: FormData,
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
    const result = editing
      ? await supabase
          .from("customers")
          .update(checked.data)
          .eq("id", id)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("customers")
          .insert({ id, ...checked.data })
          .select("id")
          .single();
    if (result.error || !result.data) {
      // A retry with the same form ID is successful only if the stored data agrees.
      // Never upsert: a stale create retry must not overwrite a subsequent edit.
      if (!editing && result.error?.code === "23505") {
        const existing = await supabase
          .from("customers")
          .select("name,phone,business_name,address")
          .eq("id", id)
          .maybeSingle();
        if (
          existing.error ||
          !existing.data ||
          !sameCustomerDetails(existing.data, checked.data)
        ) {
          return {
            values,
            errors: {},
            message:
              "This form was already saved with different details. Open the customer list to check.",
          };
        }
      } else {
        return {
          values,
          errors: {},
          message:
            "Could not save the customer. Your details are still here. Please try again.",
        };
      }
    }
  } catch {
    return {
      values,
      errors: {},
      message:
        "Could not connect. Your details are still here. Please try again.",
    };
  }
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?saved=${editing ? "updated" : "added"}`);
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
