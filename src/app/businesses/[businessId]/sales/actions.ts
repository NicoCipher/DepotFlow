"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/domain/ids";

type Line = { productId: string; crates: number; bottles: number };
type Input = {
  businessId: string; requestId: string; customerId: string; businessDate: string;
  paid: number; paymentMethod: "cash" | "transfer" | "pos"; lines: Line[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveBusinessSale(input: Input) {
  if (!input || !isUuid(input.businessId) || !uuid.test(input.requestId) ||
      !uuid.test(input.customerId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate) ||
      !Number.isSafeInteger(input.paid) || input.paid < 0 ||
      !["cash", "transfer", "pos"].includes(input.paymentMethod) ||
      !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100 ||
      input.lines.some((line) => !line || !uuid.test(line.productId) ||
        !Number.isSafeInteger(line.crates) || line.crates < 0 ||
        !Number.isSafeInteger(line.bottles) || line.bottles < 0 ||
        line.crates + line.bottles < 1) ||
      new Set(input.lines.map((line) => line.productId)).size !== input.lines.length) {
    return { error: "Check the customer, quantities and payment details." };
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Sign in again before recording this sale." };

  const { data: businesses, error: listError } = await supabase.rpc("list_my_businesses_for_setup");
  if (listError || !businesses?.some((b) =>
    b.business_id === input.businessId && b.business_status === "active" && b.member_kind === "owner")) {
    return { error: "This depot is not available for sales on this account." };
  }

  const [customerResult, productResult] = await Promise.all([
    supabase.from("customers").select("id,business_id,archived_at,empties_deposit_required")
      .eq("business_id", input.businessId).eq("id", input.customerId)
      .is("archived_at", null).maybeSingle(),
    supabase.from("products")
      .select("id,business_id,name,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,bottle_type,crate_type_id,stock!stock_product_id_fkey(total_bottles)")
      .eq("business_id", input.businessId).eq("is_active", true)
      .in("id", input.lines.map((line) => line.productId)),
  ]);
  if (customerResult.error || !customerResult.data || customerResult.data.business_id !== input.businessId)
    return { error: "Choose an active customer from this depot." };
  if (customerResult.data.empties_deposit_required)
    return { error: "This customer requires an empties deposit. This first checkout screen does not yet support returned-container or deposit handling." };
  if (productResult.error || !productResult.data || productResult.data.length !== input.lines.length ||
      productResult.data.some((p) => p.business_id !== input.businessId))
    return { error: "One or more drinks are no longer available in this depot." };

  const byId = new Map(productResult.data.map((p) => [p.id, p]));
  const rpcLines = [];
  for (const line of input.lines) {
    const p = byId.get(line.productId);
    if (!p || !Number.isSafeInteger(p.bottles_per_crate) || p.bottles_per_crate < 1)
      return { error: "A selected drink has invalid setup. Correct it before selling." };
    const stock = p.stock?.total_bottles ?? null;
    if (!Number.isSafeInteger(stock) || stock < 0)
      return { error: "Starting stock has not been verified for every selected drink." };
    const quantity = line.crates * p.bottles_per_crate + line.bottles;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > stock)
      return { error: `Not enough stock for ${p.name}. Review the quantity.` };
    rpcLines.push({
      productId: p.id,
      quantity: { crates: line.crates, fraction: 0, bottles: line.bottles },
      returnedCrates: 0, returnedBottles: 0,
      expected: {
        full: p.full_crate_price, half: p.half_crate_price, quarter: p.quarter_crate_price,
        bottle: p.bottle_price, size: p.bottles_per_crate, crate: p.crate_type_id,
        returnable: p.bottles_returnable, bottleType: p.bottle_type, stock,
      },
    });
  }

  const { data, error } = await supabase.rpc("save_business_sale_v2", {
    p_business_id: input.businessId, p_request_id: input.requestId,
    p_customer_id: input.customerId, p_business_date: input.businessDate,
    p_paid: input.paid, p_payment_method: input.paid > 0 ? input.paymentMethod : "not_recorded",
    p_lines: rpcLines, p_returned_crates: [], p_returned_bottles: [],
  });
  if (error) {
    const message = /business sales are not available|business operations are not available/i.test(error.message)
      ? "Sales for this depot have not been enabled yet."
      : /price or product details changed/i.test(error.message)
      ? "A drink's price or setup changed. Refresh and review the sale again."
      : /not enough stock/i.test(error.message)
      ? "There is not enough stock. Refresh and correct the quantity."
      : /amount paid cannot exceed/i.test(error.message)
      ? "The amount received cannot be more than the sale total."
      : "The sale could not be saved. Check the details and try again.";
    return { error: message };
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      typeof data.id !== "string" || data.businessId !== input.businessId || data.requestId !== input.requestId)
    return { error: "The save response could not be verified. Do not create another sale until its status is checked." };
  revalidatePath(`/businesses/${input.businessId}/sales`);
  return { result: data as { id: string; total: number; paid: number; owing: number; customer: string } };
}
