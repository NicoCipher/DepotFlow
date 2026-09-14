"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import {
  emptyCrateCountPreview,
  type EmptyCrateCountState,
} from "@/domain/empty-crates";

export async function reviewEmptyCrateCount(
  crateTypeId: string,
  _previous: EmptyCrateCountState,
  form: FormData,
): Promise<EmptyCrateCountState> {
  const supabase = await requireOwner();
  const values = {
    quantity: String(form.get("quantity") ?? ""),
    businessDate: String(form.get("businessDate") ?? ""),
  };
  const { data, error } = await supabase
    .from("known_empty_crates")
    .select("crate_type_id,quantity")
    .eq("crate_type_id", crateTypeId)
    .maybeSingle();
  if (error || !data)
    return { ...values, message: "Could not load this crate type. Try again." };
  try {
    return {
      ...values,
      review: emptyCrateCountPreview(
        values.quantity,
        values.businessDate,
        data.quantity,
      ),
    };
  } catch (error) {
    return {
      ...values,
      message: error instanceof Error ? error.message : "Check your count.",
    };
  }
}
export async function confirmEmptyCrateCount(
  crateTypeId: string,
  requestId: string,
  review: NonNullable<EmptyCrateCountState["review"]>,
): Promise<{ message: string }> {
  const supabase = await requireOwner();
  if (!isProductId(requestId))
    return { message: "Please reopen Set Current Count." };
  try {
    const checked = emptyCrateCountPreview(
      String(review.quantity),
      review.businessDate,
      review.previousQuantity,
    );
    const { error } = await supabase.rpc("set_empty_crate_count", {
      p_request_id: requestId,
      p_crate_type_id: crateTypeId,
      p_quantity: checked.quantity,
      p_business_date: checked.businessDate,
      p_expected_quantity: checked.previousQuantity,
    });
    if (error)
      return {
        message:
          error.code === "22023"
            ? error.message
            : "Could not save. You can safely try again.",
      };
  } catch {
    return { message: "Could not save. Check your count or safely try again." };
  }
  revalidatePath("/empty-crates");
  revalidatePath("/stock");
  redirect("/empty-crates?saved=1");
}
