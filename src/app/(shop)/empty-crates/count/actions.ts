"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import {
  emptyCrateCountPreview,
  emptyCrateSaveError,
  type EmptyCrateCountState,
} from "@/domain/empty-crates";

export async function reviewEmptyCrateCount(
  crateTypeId: string,
  _previous: EmptyCrateCountState,
  form: FormData,
): Promise<EmptyCrateCountState> {
  const values = {
    quantity: String(form.get("quantity") ?? ""),
    businessDate: String(form.get("businessDate") ?? ""),
  };
  if (!isProductId(crateTypeId)) return { ...values, message: "Choose an existing crate type." };
  let session: Awaited<ReturnType<typeof ownerSession>>;
  try { session = await ownerSession(); } catch { return { ...values, message: "Could not load empty crates. Try again." }; }
  if (!session.allowed || !session.user) return { ...values, message: "Your session has expired. Sign in again to review empty crates." };
  let data: { crate_type_id: string | null; quantity: number | null } | null;
  try {
  const result = await session.supabase
    .from("known_empty_crates")
    .select("crate_type_id,quantity")
    .eq("crate_type_id", crateTypeId)
    .maybeSingle();
  if (result.error) return { ...values, message: "Could not load this crate type. Try again." };
  data = result.data;
  } catch { return { ...values, message: "Could not load empty crates. Try again." }; }
  if (!data)
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
    const message = error instanceof Error ? error.message : "Check your count.";
    return {
      ...values,
      message: ["Enter a whole number of crates, zero or more.", "Choose a valid business date."].includes(message) ? message : "Could not review this count. Try again.",
      field: message === "Choose a valid business date." ? "businessDate" : message === "Enter a whole number of crates, zero or more." ? "quantity" : undefined,
    };
  }
}
export async function confirmEmptyCrateCount(
  crateTypeId: string,
  requestId: string,
  review: NonNullable<EmptyCrateCountState["review"]>,
): Promise<{ message: string; retryable?: boolean }> {
  if (!isProductId(crateTypeId) || !isProductId(requestId))
    return { message: "Please reopen Set Current Count." };
  let checked: ReturnType<typeof emptyCrateCountPreview>;
  try {
    checked = emptyCrateCountPreview(
      String(review.quantity),
      review.businessDate,
      review.previousQuantity,
    );
  } catch { return { message: "Check the count and business date, then review again." }; }
  let session: Awaited<ReturnType<typeof ownerSession>>;
  try { session = await ownerSession(); } catch { return emptyCrateSaveError(); }
  if (!session.allowed || !session.user) return emptyCrateSaveError("42501");
  try {
    const { error } = await session.supabase.rpc("set_empty_crate_count", {
      p_request_id: requestId,
      p_crate_type_id: crateTypeId,
      p_quantity: checked.quantity,
      p_business_date: checked.businessDate,
      // Generated type says `number`, but the SQL function's p_expected_quantity
      // is nullable and NULL means "not recorded" (part of the concurrency
      // rule). Supabase's type generation can't express that here; cast to
      // keep the real null/number value at runtime.
      p_expected_quantity: checked.previousQuantity as number,
    });
    if (error) return emptyCrateSaveError(error.code, error.message);
  } catch {
    return emptyCrateSaveError();
  }
  revalidatePath("/empty-crates");
  revalidatePath("/stock");
  redirect("/empty-crates?saved=1");
}
