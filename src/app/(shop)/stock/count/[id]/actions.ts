"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { stockCountInputField, stockCountPreview, stockCountSaveError, type StockCountState } from "@/domain/stock-count";

export async function reviewCount(
  productId: string,
  _previous: StockCountState,
  form: FormData,
): Promise<StockCountState> {
  const values = {
    crates: String(form.get("crates") ?? ""),
    bottles: String(form.get("bottles") ?? ""),
    businessDate: String(form.get("businessDate") ?? ""),
  };
  if (!isProductId(productId))
    return { ...values, message: "Product not found." };
  let session: Awaited<ReturnType<typeof ownerSession>>;
  try { session = await ownerSession(); } catch {
    return { ...values, message: "Could not load stock. Try again." };
  }
  if (!session.allowed || !session.user)
    return { ...values, message: "Your session has expired. Sign in again to review stock." };
  let data: { bottles_per_crate: number; stock: { total_bottles: number } | null } | null;
  try {
  const result = await session.supabase
    .from("products")
    .select("bottles_per_crate,stock(total_bottles)")
    .eq("id", productId)
    .maybeSingle();
  if (result.error) return { ...values, message: "Could not load stock. Try again." };
  data = result.data;
  } catch { return { ...values, message: "Could not load stock. Try again." }; }
  if (!data)
    return { ...values, message: "Could not load stock. Try again." };
  try {
    return {
      ...values,
      review: stockCountPreview(
        values.crates,
        values.bottles,
        values.businessDate,
        data.stock?.total_bottles ?? 0,
        data.bottles_per_crate,
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check your stock count.";
    return {
      ...values,
      message: message === "Choose a valid business date." || message === "Enter whole numbers of crates and loose bottles, zero or more." || message === "Loose bottles must be fewer than a full crate." || message === "That would exceed the stock limit." ? message : "Could not review this count. Try again.",
      field: stockCountInputField(values.crates, values.bottles, values.businessDate) ?? (message === "Loose bottles must be fewer than a full crate." ? "bottles" : message === "That would exceed the stock limit." ? "crates" : undefined),
    };
  }
}
export async function confirmCount(
  productId: string,
  requestId: string,
  review: NonNullable<StockCountState["review"]>,
): Promise<{ message: string; retryable?: boolean }> {
  if (!isProductId(productId) || !isProductId(requestId))
    return { message: "Please reopen Set Current Stock." };
  let checked: ReturnType<typeof stockCountPreview>;
  try {
    checked = stockCountPreview(
      String(review.crates),
      String(review.bottles),
      review.businessDate,
      review.stock,
      review.bottlesPerCrate,
    );
  } catch { return { message: "Check the count and business date, then review again." }; }
  let session: Awaited<ReturnType<typeof ownerSession>>;
  try { session = await ownerSession(); } catch { return stockCountSaveError(); }
  if (!session.allowed || !session.user) return stockCountSaveError("42501");
  try {
    const { error } = await session.supabase.rpc("set_current_stock", {
      p_product_id: productId,
      p_request_id: requestId,
      p_crates: checked.crates,
      p_loose_bottles: checked.bottles,
      p_business_date: checked.businessDate,
      p_expected_stock: checked.stock,
      p_expected_bottles_per_crate: checked.bottlesPerCrate,
    });
    if (error) return stockCountSaveError(error.code, error.message);
  } catch {
    return stockCountSaveError();
  }
  revalidatePath("/stock");
  redirect("/stock?counted=1");
}
