"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/domain/ids";
import { validateBusinessDate } from "@/domain/stock-count";
import { receivingPreview, receivingSaveError, type ReceivingState } from "@/domain/receiving";
import { createClient } from "@/lib/supabase/server";

export type BusinessReceivingSaveState = {
  message: string;
  saved: boolean;
  retryable?: boolean;
  stockAfter?: number;
  emptiesAfter?: number;
};

async function activeOwnerCanReceive(supabase: Awaited<ReturnType<typeof createClient>>, businessId: string) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) return false;
  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  if (listError || !businesses?.some((item) =>
    item.business_id === businessId &&
    item.member_kind === "owner" &&
    item.business_status === "active"
  )) return false;
  const { data, error } = await supabase.rpc("can_receive_business_stock", {
    p_business_id: businessId,
  });
  return !error && data === true;
}

export async function reviewBusinessReceiving(
  businessId: string,
  productId: string,
  _previous: ReceivingState,
  form: FormData,
): Promise<ReceivingState> {
  const crates = String(form.get("crates") ?? "");
  const rawDate = String(form.get("business_date") ?? "");
  if (!isUuid(businessId) || !isUuid(productId)) {
    return { crates, businessDate: rawDate, message: "This stock item is invalid." };
  }
  const supabase = await createClient();
  if (!(await activeOwnerCanReceive(supabase, businessId))) {
    return { crates, businessDate: rawDate, message: "Stock receiving is not available to this depot owner yet." };
  }
  let businessDate: string;
  try { businessDate = validateBusinessDate(rawDate); }
  catch { return { crates, businessDate: rawDate, message: "Choose a valid business date.", field: "businessDate" }; }

  const product = await supabase.from("products")
    .select("id,business_id,name,size,bottles_per_crate,crate_type_id,is_active,crate_types(name,pocket_count),stock(total_bottles)")
    .eq("id", productId).eq("business_id", businessId).maybeSingle();
  if (product.error || !product.data || product.data.business_id !== businessId || !product.data.is_active) {
    return { crates, businessDate, message: "This drink is no longer available in this depot." };
  }
  const empty = await supabase.from("empty_crate_stock")
    .select("business_id,crate_type_id,quantity")
    .eq("business_id", businessId)
    .eq("crate_type_id", product.data.crate_type_id)
    .maybeSingle();
  if (empty.error || (empty.data && empty.data.business_id !== businessId)) {
    return { crates, businessDate, message: "Could not verify matching empty crates. Try again." };
  }

  try {
    const snapshot = receivingPreview(crates, {
      stock: product.data.stock?.total_bottles ?? 0,
      empties: empty.data?.quantity ?? 0,
      bottlesPerCrate: product.data.bottles_per_crate,
      crateType: product.data.crate_types.name,
      crateDescription: undefined,
      crateTypeId: product.data.crate_type_id,
    });
    return {
      crates,
      businessDate,
      review: {
        ...snapshot,
        businessDate,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not review this receipt.";
    return {
      crates,
      businessDate,
      message: [ "Enter a positive whole number of crates.", "Not enough empty crates of this type.", "That would exceed the stock limit." ].includes(message)
        ? message
        : "Could not review this receipt. Check the quantity and try again.",
      field: message === "Choose a valid business date." ? "businessDate" : "crates",
    };
  }
}

export async function confirmBusinessReceiving(
  businessId: string,
  productId: string,
  requestId: string,
  review: NonNullable<ReceivingState["review"]>,
  _previous: BusinessReceivingSaveState,
  _form: FormData,
): Promise<BusinessReceivingSaveState> {
  if (!isUuid(businessId) || !isUuid(productId) || !isUuid(requestId)) {
    return { message: "Reopen the receiving form and review the stock again.", saved: false };
  }
  let businessDate: string;
  try {
    businessDate = validateBusinessDate(review.businessDate);
    receivingPreview(String(review.crates), review);
  } catch {
    return { message: "The review is no longer valid. Go back and review the quantity again.", saved: false };
  }
  const supabase = await createClient();
  if (!(await activeOwnerCanReceive(supabase, businessId))) {
    return { message: "Stock receiving is no longer available to this depot owner.", saved: false };
  }

  const { data, error } = await supabase.rpc("receive_business_stock", {
    p_business_id: businessId,
    p_request_id: requestId,
    p_product_id: productId,
    p_crates: review.crates,
    p_expected_stock: review.stock,
    p_expected_empties: review.empties,
    p_expected_bottles_per_crate: review.bottlesPerCrate,
    p_expected_crate_type_id: review.crateTypeId,
    p_business_date: businessDate,
  });
  if (error) {
    const mapped = receivingSaveError(error.code, error.message);
    return { message: mapped.message, saved: false, retryable: mapped.retryable };
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      data.businessId !== businessId || data.requestId !== requestId ||
      typeof data.stock_after !== "number" || typeof data.empties_after !== "number") {
    return {
      message: "The receipt was not confirmed. Refresh stock and check the latest quantities before retrying.",
      saved: false,
      retryable: true,
    };
  }
  revalidatePath(`/businesses/${businessId}/stock`);
  revalidatePath(`/businesses/${businessId}/sales`);
  return {
    message: "Stock received successfully.",
    saved: true,
    stockAfter: data.stock_after,
    emptiesAfter: data.empties_after,
  };
}
