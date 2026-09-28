"use server";
import { crateDescription } from "@/domain/crate-types";
import { validateBusinessDate } from "@/domain/stock-count";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { receivingPreview, receivingSaveError, type ReceivingState } from "@/domain/receiving";

export async function reviewReceiving(
  productId: string,
  _previous: ReceivingState,
  form: FormData,
): Promise<ReceivingState> {
  const crates = String(form.get("crates") ?? "");
  const businessDate = String(form.get("businessDate") ?? "");
  if (!isProductId(productId))
    return { crates, businessDate, message: "Product not found." };
  let session: Awaited<ReturnType<typeof ownerSession>>;
  try { session = await ownerSession(); } catch { return { crates, businessDate, message: "Could not load stock. Try again." }; }
  if (!session.allowed || !session.user) return { crates, businessDate, message: "Your session has expired. Sign in again to review stock." };
  const { supabase } = session;
  try {
  const product = await supabase
    .from("products")
    .select(
      "bottles_per_crate,crate_type_id,crate_types(*),stock(total_bottles)",
    )
    .eq("id", productId)
    .maybeSingle();
  if (product.error || !product.data)
    return {
      crates,
      businessDate,
      message: "Could not load the product. Try again.",
    };
  const empty = await supabase
    .from("empty_crate_stock")
    .select("quantity")
    .eq("crate_type_id", product.data.crate_type_id)
    .maybeSingle();
  if (empty.error)
    return {
      crates,
      businessDate,
      message: "Could not load empty crates. Try again.",
    };
  try {
    return {
      crates,
      businessDate,
      review: {
        businessDate: validateBusinessDate(businessDate),
        ...receivingPreview(crates, {
          stock: product.data.stock?.total_bottles ?? 0,
          empties: empty.data?.quantity ?? 0,
          bottlesPerCrate: product.data.bottles_per_crate,
          crateType: product.data.crate_types.name,
          crateDescription: crateDescription(product.data.crate_types),
          crateTypeId: product.data.crate_type_id,
        }),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check the number of crates.";
    return {
      crates,
      businessDate,
      message: ["Enter a positive whole number of crates.", "Not enough empty crates of this type.", "That would exceed the stock limit.", "Choose a valid business date."].includes(message) ? message : "Could not review stock. Try again.",
      field: message === "Choose a valid business date." ? "businessDate" : ["Enter a positive whole number of crates.", "Not enough empty crates of this type.", "That would exceed the stock limit."].includes(message) ? "crates" : undefined,
    };
  }
  } catch { return { crates, businessDate, message: "Could not load stock. Try again." }; }
}

export async function confirmReceiving(
  productId: string,
  requestId: string,
  review: NonNullable<ReceivingState["review"]>,
): Promise<{ message: string; retryable?: boolean }> {
  if (!isProductId(productId) || !isProductId(requestId))
    return { message: "Please reopen Receive Stock." };
  let date: string;
  try { date = validateBusinessDate(review.businessDate); receivingPreview(String(review.crates), review); }
  catch { return { message: "Check the amount and business date, then review again." }; }
  let session: Awaited<ReturnType<typeof ownerSession>>;
  try { session = await ownerSession(); } catch { return receivingSaveError(); }
  if (!session.allowed || !session.user) return receivingSaveError("42501");
  try {
    const { error } = await session.supabase.rpc("receive_stock", {
      p_product_id: productId,
      p_request_id: requestId,
      p_crates: review.crates,
      p_business_date: date,
      p_expected_stock: review.stock,
      p_expected_empties: review.empties,
      p_expected_bottles_per_crate: review.bottlesPerCrate,
      p_expected_crate_type_id: review.crateTypeId,
    });
    if (error) return receivingSaveError(error.code, error.message);
  } catch {
    return receivingSaveError();
  }
  revalidatePath("/stock");
  revalidatePath("/empty-crates");
  redirect("/stock?received=1");
}
