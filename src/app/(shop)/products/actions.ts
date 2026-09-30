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
  const crate = await supabase
    .from("crate_types")
    .select("pocket_count,is_legacy,empty_family")
    .eq("id", checked.data.crate_type_id)
    .maybeSingle();
  if (
    crate.error ||
    !crate.data ||
    crate.data.is_legacy ||
    crate.data.pocket_count === null ||
    !crate.data.empty_family ||
    crate.data.pocket_count !== checked.data.bottles_per_crate
  )
    return {
      values,
      errors: {
        crate_type_id:
          "Choose the complete physical crate this drink uses. Its bottle spaces must match the bottles per crate.",
      },
      message: "Finish the physical crate details.",
    };
  const catalogueId = editing ? "" : String(formData.get("catalogue_product_id") ?? "");
  if (catalogueId) {
    if (!isProductId(catalogueId)) return { values, errors: {}, message: "Choose the drink again from the catalogue." };
    const drink = await supabase.from("product_catalogue").select("id").eq("id", catalogueId).maybeSingle();
    if (drink.error || !drink.data) return { values, errors: {}, message: "Could not find this catalogue drink. Your details are still here. Please try again." };
  }
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
          .insert({ id, ...checked.data, ...(catalogueId ? { catalogue_product_id: catalogueId } : {}) })
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
          !sameProductDetails(existing.data, checked.data) ||
          existing.data.catalogue_product_id !== (catalogueId || null)
        ) {
          return {
            values,
            errors: {},
            message:
              "This drink may already be in your shop. Open Products to check before adding it again.",
          };
        }
      } else {
        return {
          values,
          errors: {},
          message:
            result.error?.code === "23514"
              ? "The physical crate must have the same number of bottle spaces as the drink has bottles per crate."
              : "Could not save the product. Your details are still here. Please try again.",
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
  revalidatePath("/products/catalogue");
  revalidatePath("/empty-crates");
  revalidatePath("/stock");
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
