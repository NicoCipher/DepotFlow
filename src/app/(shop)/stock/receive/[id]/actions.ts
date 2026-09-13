"use server";
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
  if (!isProductId(productId)) return { crates, message: "Product not found." };
  const product = await supabase
    .from("products")
    .select("bottles_per_crate,crate_type,stock(total_bottles)")
    .eq("id", productId)
    .maybeSingle();
  if (product.error || !product.data)
    return { crates, message: "Could not load the product. Try again." };
  const empty = await supabase
    .from("empty_crate_stock")
    .select("quantity")
    .eq("crate_type", product.data.crate_type)
    .maybeSingle();
  if (empty.error)
    return { crates, message: "Could not load empty crates. Try again." };
  try {
    return {
      crates,
      review: receivingPreview(crates, {
        stock: product.data.stock?.total_bottles ?? 0,
        empties: empty.data?.quantity ?? 0,
        bottlesPerCrate: product.data.bottles_per_crate,
        crateType: product.data.crate_type,
      }),
    };
  } catch (error) {
    return {
      crates,
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
    return { message: "Please reopen Add Stock." };
  try {
    const { error } = await supabase.rpc("receive_stock", {
      p_product_id: productId,
      p_request_id: requestId,
      p_crates: review.crates,
      p_expected_stock: review.stock,
      p_expected_empties: review.empties,
      p_expected_bottles_per_crate: review.bottlesPerCrate,
      p_expected_crate_type: review.crateType,
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
  redirect("/stock?received=1");
}
