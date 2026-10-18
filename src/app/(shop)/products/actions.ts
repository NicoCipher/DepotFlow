"use server";

import { redirect } from "next/navigation";
import { catalogueImageUrl } from "@/domain/product-images";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import {
  isProductId,
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
  // Photo references are managed only by the owner-only Storage upload action.
  // Ignore even forged image_url form fields.
  const checked = validateProduct({ ...values, image_url: "" });
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
  let catalogueImage: string | null = null;
  if (catalogueId) {
    if (!isProductId(catalogueId)) return { values, errors: {}, message: "Choose the drink again from the catalogue." };
    const drink = await supabase.from("product_catalogue").select("id,image_path").eq("id", catalogueId).maybeSingle();
    if (drink.error || !drink.data) return { values, errors: {}, message: "Could not find this catalogue drink. Your details are still here. Please try again." };
    catalogueImage = catalogueImageUrl(drink.data.image_path);
  }
  // Do not overwrite a managed photo when editing prices, crates, or names.
  const { image_url: _untrustedImageUrl, ...safeDetails } = checked.data;
  void _untrustedImageUrl;
  let savedId = id;
  try {
    if (editing) {
      const result = await supabase.from("products")
        .update(safeDetails).eq("id", id).select("id").maybeSingle();
      if (result.error || result.data?.id !== id) {
        return {
          values, errors: {},
          message: result.error?.code === "23514"
            ? "The physical crate must match the drink's bottle count."
            : "Could not update this drink. Check its details and retry.",
        };
      }
    } else {
      // 'id' from the form is ONLY a request token. PostgreSQL generates the
      // actual primary key and the audited RPC deduplicates exact retries.
      const { data, error } = await supabase.rpc("create_legacy_product", {
        p_request_id: id,
        p_name: safeDetails.name,
        p_size: safeDetails.size,
        p_image_url: catalogueImage,
        p_crate_type_id: safeDetails.crate_type_id,
        p_bottles_per_crate: safeDetails.bottles_per_crate,
        p_full_crate_price: safeDetails.full_crate_price,
        p_half_crate_price: safeDetails.half_crate_price,
        p_quarter_crate_price: safeDetails.quarter_crate_price,
        p_bottle_price: safeDetails.bottle_price,
        p_bottles_returnable: safeDetails.bottles_returnable,
        p_bottle_type: safeDetails.bottle_type,
        p_catalogue_product_id: catalogueId || null,
      });
      if (error || !isProductId(data)) {
        return {
          values, errors: {},
          message: error?.code === "23514" || error?.code === "22023"
            ? "Check the drink's crate, prices and saved details before trying again."
            : "Could not confirm this drink was saved. Refresh the catalogue to check before retrying.",
        };
      }
      savedId = data;
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
  revalidatePath(`/products/${savedId}`);
  redirect(`/products/${savedId}?saved=${editing ? "updated" : "added"}`);
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

/**
 * A shop can stop stocking/selling a drink without deleting the master
 * catalogue, its physical stock, customer history or receipts.
 * The RPC serializes this change against a concurrent sale.
 */
export async function setShopDrinkStatus(
  id: string,
  active: boolean,
  expectedActive: boolean,
): Promise<{ saved?: boolean; message?: string }> {
  const supabase = await requireOwner();
  if (!isProductId(id) || typeof active !== "boolean" || typeof expectedActive !== "boolean")
    return { message: "Reopen this drink and try again." };
  try {
    const { error } = await supabase.rpc("set_shop_drink_active", {
      p_id: id,
      p_active: active,
      p_expected_active: expectedActive,
    });
    if (error) return {
      message: error.code === "40001"
        ? "This drink changed on another screen. Refresh before trying again."
        : error.code === "P0002"
          ? "Drink no longer exists. Return to Drinks."
          : "Could not update the drink. Check your connection and try again.",
    };
    revalidatePath("/", "layout");
    revalidatePath("/products");
    revalidatePath("/products/catalogue");
    revalidatePath("/stock");
    revalidatePath("/record-sale");
    revalidatePath(`/products/${id}`);
    return { saved: true };
  } catch {
    return { message: "Could not confirm whether this drink changed. Reload the page and check its status." };
  }
}
