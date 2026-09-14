"use server";
import { requireOwner } from "@/lib/auth/owner";
import { revalidatePath } from "next/cache";
import { isProductId } from "@/domain/products";
import type { CrateType } from "@/domain/crate-types";
import { newProductCrate } from "@/domain/product-crate";
export async function createCrateType(
  id: string,
  values: Parameters<typeof newProductCrate>[0],
): Promise<{ crate?: CrateType; message?: string }> {
  const supabase = await requireOwner();
  if (!isProductId(id)) return { message: "Reopen the crate form." };
  let checked;
  try {
    checked = newProductCrate(values);
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Check the crate details.",
    };
  }
  try {
    const { error } = await supabase.rpc("create_crate_type", {
      p_id: id,
      p_name: checked.name,
      p_empty_family: checked.empty_family,
      p_pocket_count: checked.pocket_count,
      p_variant: checked.variant,
    });
    if (error)
      return {
        message:
          error.code === "22023"
            ? error.message
            : "Could not save the crate type. You can safely retry.",
      };
    const result = await supabase
      .from("crate_types")
      .select("*")
      .eq("id", id)
      .single();
    if (result.error)
      return {
        message: "Could not load the saved crate type. You can safely retry.",
      };
    revalidatePath("/empty-crates");
    return { crate: result.data };
  } catch {
    return { message: "Could not connect. You can safely retry." };
  }
}
