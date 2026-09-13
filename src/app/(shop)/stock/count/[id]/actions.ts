"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { stockCountPreview, type StockCountState } from "@/domain/stock-count";

export async function reviewCount(
  productId: string,
  _previous: StockCountState,
  form: FormData,
): Promise<StockCountState> {
  const supabase = await requireOwner();
  const values = {
    crates: String(form.get("crates") ?? ""),
    bottles: String(form.get("bottles") ?? ""),
    businessDate: String(form.get("businessDate") ?? ""),
  };
  if (!isProductId(productId))
    return { ...values, message: "Product not found." };
  const { data, error } = await supabase
    .from("products")
    .select("bottles_per_crate,stock(total_bottles)")
    .eq("id", productId)
    .maybeSingle();
  if (error || !data)
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
    return {
      ...values,
      message:
        error instanceof Error ? error.message : "Check your stock count.",
    };
  }
}
export async function confirmCount(
  productId: string,
  requestId: string,
  review: NonNullable<StockCountState["review"]>,
): Promise<{ message: string }> {
  const supabase = await requireOwner();
  if (!isProductId(productId) || !isProductId(requestId))
    return { message: "Please reopen Set Current Stock." };
  try {
    const checked = stockCountPreview(
      String(review.crates),
      String(review.bottles),
      review.businessDate,
      review.stock,
      review.bottlesPerCrate,
    );
    const { error } = await supabase.rpc("set_current_stock", {
      p_product_id: productId,
      p_request_id: requestId,
      p_crates: checked.crates,
      p_loose_bottles: checked.bottles,
      p_business_date: checked.businessDate,
      p_expected_stock: checked.stock,
      p_expected_bottles_per_crate: checked.bottlesPerCrate,
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
  revalidatePath("/stock");
  redirect("/stock?counted=1");
}
