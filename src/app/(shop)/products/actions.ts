"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import {
  isProductId,
  sameProductDetails,
  validateProduct,
  type ProductFormState,
  type ProductValues,
  emptyProduct,
} from "@/domain/products";

async function save(
  id: string,
  editing: boolean,
  formData: FormData,
): Promise<ProductFormState> {
  const supabase = await requireOwner();
  const values = Object.fromEntries(
    Object.keys(emptyProduct).map((field) => [
      field,
      String(formData.get(field) ?? ""),
    ]),
  ) as ProductValues;
  const checked = validateProduct(values);
  if (!checked.valid)
    return {
      values,
      errors: checked.errors,
      message: "Check the details below.",
    };
  if (!isProductId(id))
    return {
      values,
      errors: {},
      message: "Please reopen this form and try again.",
    };
  try {
    const result = editing
      ? await supabase
          .from("products")
          .update(checked.data)
          .eq("id", id)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("products")
          .insert({ id, ...checked.data })
          .select("id")
          .single();
    if (result.error || !result.data) {
      // A retry with the same form ID is successful only if the stored data agrees.
      // Never upsert: a stale create retry must not overwrite a subsequent edit.
      if (!editing && result.error?.code === "23505") {
        const existing = await supabase
          .from("products")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (
          existing.error ||
          !existing.data ||
          !sameProductDetails(existing.data, checked.data)
        ) {
          return {
            values,
            errors: {},
            message:
              "This form was already saved with different details. Open the product list to check.",
          };
        }
      } else {
        return {
          values,
          errors: {},
          message:
            "Could not save the product. Your details are still here. Please try again.",
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
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}?saved=${editing ? "updated" : "added"}`);
}

export async function addProduct(
  id: string,
  _previous: ProductFormState,
  formData: FormData,
) {
  return save(id, false, formData);
}
export async function editProduct(
  id: string,
  _previous: ProductFormState,
  formData: FormData,
) {
  return save(id, true, formData);
}
