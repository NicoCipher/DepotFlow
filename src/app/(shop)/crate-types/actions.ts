"use server";
import { requireOwner } from "@/lib/auth/owner";
import { getCrateTypes } from "@/lib/crate-types/data";
import { validateCrateType } from "@/domain/crate-types";
import { isProductId } from "@/domain/products";
import { revalidatePath } from "next/cache";
export async function refreshCrateTypes() {
  return getCrateTypes();
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
        p_variant: checked.variant,
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
