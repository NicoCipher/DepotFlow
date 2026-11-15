"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/domain/ids";

type Line = { productId: string; crates: number; bottles: number; returnedCrates: number; returnedBottles: number };
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
        line.crates + line.bottles < 1 ||
        !Number.isSafeInteger(line.returnedCrates) || line.returnedCrates < 0 || line.returnedCrates > line.crates ||
        !Number.isSafeInteger(line.returnedBottles) || line.returnedBottles < 0) ||
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
      .select("id,business_id,name,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,bottle_type,crate_type_id,crate_type:crate_types!products_crate_type_id_fkey(name,is_legacy,pocket_count,empty_family),stock!stock_product_id_fkey(total_bottles)")
      .eq("business_id", input.businessId).eq("is_active", true)
      .in("id", input.lines.map((line) => line.productId)),
  ]);
  if (customerResult.error || !customerResult.data || customerResult.data.business_id !== input.businessId)
    return { error: "Choose an active customer from this depot." };
  if (productResult.error || !productResult.data || productResult.data.length !== input.lines.length ||
      productResult.data.some((p) => p.business_id !== input.businessId))
    return { error: "One or more drinks are no longer available in this depot." };

  const byId = new Map(productResult.data.map((p) => [p.id, p]));
  const rpcLines = [];
  const returnedCrates = new Map<string, number>();
  const returnedBottles = new Map<string, number>();
  let emptiesShortage = false;
  for (const line of input.lines) {
    const p = byId.get(line.productId);
    if (!p || !Number.isSafeInteger(p.bottles_per_crate) || p.bottles_per_crate < 1 ||
        !p.crate_type_id || !p.crate_type || p.crate_type.is_legacy ||
        p.crate_type.pocket_count !== p.bottles_per_crate ||
        (p.bottles_returnable && !p.bottle_type))
      return { error: "A selected drink has incomplete crate or bottle setup. Correct it before selling." };
    const stock = p.stock?.total_bottles ?? null;
    if (stock === null || !Number.isSafeInteger(stock) || stock < 0)
      return { error: "Starting stock has not been verified for every selected drink." };
    const quantity = line.crates * p.bottles_per_crate + line.bottles;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > stock)
      return { error: `Not enough stock for ${p.name}. Review the quantity.` };
    const expectedBottles = p.bottles_returnable ? quantity : 0;
    if (line.returnedBottles > expectedBottles || (line.returnedBottles > 0 && !p.bottle_type))
      return { error: "Returned empty bottles exceed the expected amount for " + p.name + "." };
    if (line.returnedCrates > 0) returnedCrates.set(p.crate_type_id, (returnedCrates.get(p.crate_type_id) ?? 0) + line.returnedCrates);
    if (line.returnedBottles > 0 && p.bottle_type) returnedBottles.set(p.bottle_type, (returnedBottles.get(p.bottle_type) ?? 0) + line.returnedBottles);
    if (line.returnedCrates < line.crates || line.returnedBottles < expectedBottles) emptiesShortage = true;
    rpcLines.push({
      productId: p.id,
      quantity: { crates: line.crates, fraction: 0, bottles: line.bottles },
      cratesTaken: line.crates,
      returnedCrates: line.returnedCrates, returnedBottles: line.returnedBottles,
      expected: {
        full: p.full_crate_price, half: p.half_crate_price, quarter: p.quarter_crate_price,
        bottle: p.bottle_price, size: p.bottles_per_crate, crate: p.crate_type_id,
        returnable: p.bottles_returnable, bottleType: p.bottle_type, stock,
      },
    });
  }

  if (customerResult.data.empties_deposit_required && emptiesShortage)
    return { error: "This customer requires all expected empty crates and bottles to be returned. Deposit handling for shortages is not enabled yet." };

  const { data, error } = await supabase.rpc("save_business_sale_v2", {
    p_business_id: input.businessId, p_request_id: input.requestId,
    p_customer_id: input.customerId, p_business_date: input.businessDate,
    p_paid: input.paid, p_payment_method: input.paid > 0 ? input.paymentMethod : "not_recorded",
    p_lines: rpcLines,
    p_returned_crates: [...returnedCrates].map(([crateTypeId, quantity]) => ({ crateTypeId, quantity })),
    p_returned_bottles: [...returnedBottles].map(([bottleType, quantity]) => ({ bottleType, quantity })),
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
