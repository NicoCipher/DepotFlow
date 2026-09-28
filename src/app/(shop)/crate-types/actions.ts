"use server";
import { requireOwner } from "@/lib/auth/owner";
import { getCrateTypes } from "@/lib/crate-types/data";
import { validateCrateType } from "@/domain/crate-types";
import { isProductId } from "@/domain/products";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function refreshCrateTypes() {
  return getCrateTypes();
}
export async function deleteUnusedCrateType(
  id: string,
): Promise<{ deleted?: boolean; message?: string }> {
  const supabase = await requireOwner();
  if (!isProductId(id)) return { message: "Reopen the crate types page." };
  try {
    const { error } = await supabase.rpc("delete_unused_crate_type", {
      p_id: id,
    });
    if (error) {
      return {
        message:
          error.code === "23503"
            ? "This crate type has been used in products, stock, sales, counts, customer balances or crate swaps. Keep it to preserve those records."
            : error.code === "P0002"
              ? "This crate type was already removed. Refresh the page."
              : "Could not delete this crate type. Try again.",
      };
    }
    revalidatePath("/crate-types");
    revalidatePath("/products");
    revalidatePath("/empty-crates");
    revalidatePath("/empties-rules");
    return { deleted: true };
  } catch {
    return { message: "Could not connect. Try again." };
  }
}
export async function saveCrateType(
  id: string,
  editing: boolean,
  values: Parameters<typeof validateCrateType>[0],
): Promise<{ saved?: boolean; message?: string }> {
  const supabase = await requireOwner();
  if (!isProductId(id)) return { message: "Reopen the crate form." };
  let checked;
  try {
    checked = validateCrateType(values);
  } catch {
    return { message: "Enter a name, family and positive whole pocket count." };
  }
  try {
    const { error } = await supabase.rpc(
      editing ? "edit_crate_type" : "create_crate_type",
      {
        p_id: id,
        p_name: checked.name,
        p_empty_family: checked.empty_family,
        p_pocket_count: checked.pocket_count,
        // The SQL function does nullif(btrim(p_variant), ''), so an empty
        // string here becomes NULL in the database, same as passing null.
        p_variant: checked.variant ?? "",
      },
    );
    if (error)
      return {
        message:
          error.code === "55000"
            ? "This older crate record cannot be edited directly. Create an exact crate type and assign products to it instead."
            : error.code === "23514"
              ? "Pocket count must match the bottles per crate of every product using this crate."
              : "Could not save these details. Check them and try again.",
      };
    revalidatePath("/", "layout");
    return { saved: true };
  } catch {
    return {
      message:
        "Could not connect. Your details are still here. Please try again.",
    };
  }
}


export async function saveCrateSwapRules(id: string, formData: FormData) {
  const supabase = await requireOwner();
  if (!isProductId(id)) redirect("/crate-types");
  const returned = formData
    .getAll("returned_crate_type_id")
    .map(String);
  if (returned.some((value) => !isProductId(value) || value === id))
    redirect(`/crate-types/${id}/edit?rules=failed`);
  const { error } = await supabase.rpc("set_crate_swap_rules", {
    p_owed_crate_type_id: id,
    p_returned_crate_type_ids: returned,
  });
  if (error) redirect(`/crate-types/${id}/edit?rules=failed`);
  revalidatePath("/crate-types");
  revalidatePath("/empties-rules");
  revalidatePath(`/crate-types/${id}/edit`);
  redirect(`/crate-types/${id}/edit?rules=saved`);
}
