"use server";
import { crateLabel } from "@/domain/crate-types";
import { validateBusinessDate } from "@/domain/stock-count";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { receivingPreview, type ReceivingState } from "@/domain/receiving";

export async function reviewReceiving(
  productId: string,
  _previous: ReceivingState,
  form: FormData,
): Promise<ReceivingState> {
  const supabase = await requireOwner();
  const crates = String(form.get("crates") ?? "");
  const businessDate = String(form.get("businessDate") ?? "");
  if (!isProductId(productId))
    return { crates, businessDate, message: "Product not found." };
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
          crateType: crateLabel(product.data.crate_types),
          crateTypeId: product.data.crate_type_id,
        }),
      },
    };
  } catch (error) {
    return {
      crates,
      businessDate,
      message:
        error instanceof Error ? error.message : "Check the number of crates.",
    };
  }
}

export async function confirmReceiving(
  productId: string,
  requestId: string,
  review: NonNullable<ReceivingState["review"]>,
): Promise<{ message: string }> {
  const supabase = await requireOwner();
  if (!isProductId(productId) || !isProductId(requestId))
    return { message: "Please reopen Receive Stock." };
  try {
    const { error } = await supabase.rpc("receive_stock", {
      p_product_id: productId,
      p_request_id: requestId,
      p_crates: review.crates,
      p_business_date: validateBusinessDate(review.businessDate),
      p_expected_stock: review.stock,
      p_expected_empties: review.empties,
      p_expected_bottles_per_crate: review.bottlesPerCrate,
      p_expected_crate_type_id: review.crateTypeId,
    });
    if (error)
      return {
        message:
          error.code === "22023"
            ? error.message
            : "Could not save. You can safely try again.",
      };
  } catch {
    return { message: "Could not connect. You can safely try again." };
  }
  revalidatePath("/stock");
  revalidatePath("/empty-crates");
  redirect("/stock?received=1");
}
