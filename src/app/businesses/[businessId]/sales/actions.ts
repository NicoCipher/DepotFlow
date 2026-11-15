"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/domain/ids";
import { emptySaleDraft, reviewedLine, saleProductSetupIssue, type SaleCatalog, type SaleDraft, type DraftLine } from "@/domain/sale-builder";
import { actualSaleEmpties, assertSaleEmptiesResolved, cratesTakenFor, hasConfirmedAllReturned, matchSaleEmpties } from "@/domain/sale-empties";

type Line = { productId: string; crates: number; bottles: number };
type Input = {
  businessId: string; requestId: string; customerId: string; businessDate: string;
  paid: number; paymentMethod: "cash" | "transfer" | "pos"; lines: Line[];
  emptiesV2: SaleDraft["emptiesV2"];
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
      new Set(input.lines.map((line) => line.productId)).size !== input.lines.length ||
      !input.emptiesV2 || !["exact","actual"].includes(input.emptiesV2.mode)) {
    return { error: "Check the customer, quantities, returned empties and payment details." };
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
    supabase.from("customers").select("id,business_id,name,phone,archived_at,empties_deposit_required")
      .eq("business_id", input.businessId).eq("id", input.customerId)
      .is("archived_at", null).maybeSingle(),
    supabase.from("products")
      .select("id,business_id,name,size,image_url,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,bottle_type,crate_type_id,crate_type:crate_types!products_crate_type_id_fkey(business_id,name,is_legacy,pocket_count,empty_family),stock!stock_product_id_fkey(total_bottles)")
      .eq("business_id", input.businessId).eq("is_active", true)
      .in("id", input.lines.map((line) => line.productId)),
  ]);
  if (customerResult.error || !customerResult.data || customerResult.data.business_id !== input.businessId)
    return { error: "Choose an active customer from this depot." };
  if (productResult.error || !productResult.data || productResult.data.length !== input.lines.length ||
      productResult.data.some((p) => p.business_id !== input.businessId ||
        !p.crate_type || p.crate_type.business_id !== input.businessId))
    return { error: "One or more drinks or crate types are no longer available in this depot." };

  const [crateResult,swapResult]=await Promise.all([
    supabase.from("crate_types").select("id,business_id,name,is_legacy,pocket_count")
      .eq("business_id",input.businessId).eq("is_legacy",false),
    supabase.from("crate_swap_rules").select("business_id,owed_crate_type_id,returned_crate_type_id")
      .eq("business_id",input.businessId),
  ]);
  if(crateResult.error||swapResult.error||
    crateResult.data?.some(row=>row.business_id!==input.businessId)||
    swapResult.data?.some(row=>row.business_id!==input.businessId))
    return { error: "Could not verify this depot's empty-container rules." };
  const crateIds=new Set((crateResult.data??[]).map(crate=>crate.id));
  const fresh:SaleCatalog={
    products:productResult.data.map(p=>({
      id:p.id,name:p.name,size:p.size,image_url:p.image_url,
      bottles_per_crate:p.bottles_per_crate,
      full_crate_price:p.full_crate_price,half_crate_price:p.half_crate_price,
      quarter_crate_price:p.quarter_crate_price,bottle_price:p.bottle_price,
      available:p.stock?.total_bottles??null,crate_type_id:p.crate_type_id??"",
      crate_type:p.crate_type?{
        name:p.crate_type.name,is_legacy:p.crate_type.is_legacy,
        pocket_count:p.crate_type.pocket_count,empty_family:p.crate_type.empty_family,
      }:null,
      bottles_returnable:p.bottles_returnable,bottle_type:p.bottle_type,
    })),
    customers:[{
      id:customerResult.data.id,name:customerResult.data.name,phone:customerResult.data.phone,
      empties_deposit_required:customerResult.data.empties_deposit_required,
    }],
    crateTypes:(crateResult.data??[]).map(({id,name,is_legacy,pocket_count})=>({id,name,is_legacy,pocket_count})),
    swapRules:(swapResult.data??[]).filter(rule=>crateIds.has(rule.owed_crate_type_id)&&crateIds.has(rule.returned_crate_type_id))
      .map(({owed_crate_type_id,returned_crate_type_id})=>({owed_crate_type_id,returned_crate_type_id})),
    bottleDepositPrice:null,crateDepositPrices:[],
  };
  const byId=new Map(fresh.products.map(product=>[product.id,product]));
  const draftLines:DraftLine[]=[];
  for(const line of input.lines){
    const product=byId.get(line.productId);
    if(!product) return {error:"A selected drink is no longer available in this depot."};
    const setupIssue=saleProductSetupIssue(product);
    if(setupIssue) return {error:product.name+": "+setupIssue};
    const stock=product.available;
    const quantity=line.crates*product.bottles_per_crate+line.bottles;
    if(stock===null||!Number.isSafeInteger(stock)||stock<0)
      return {error:"Starting stock has not been verified for every selected drink."};
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>stock)
      return {error:"Not enough stock for "+product.name+". Review the quantity."};
    draftLines.push(reviewedLine({
      productId:product.id,
      quantity:{crates:line.crates,fraction:0,bottles:line.bottles},
    },product));
  }

  const draft:SaleDraft={
    ...emptySaleDraft,
    customerId:input.customerId,
    lines:draftLines,
    step:"empties",
    businessDate:input.businessDate,
    paid:String(input.paid),
    paymentMethod:input.paymentMethod,
    emptiesV2:input.emptiesV2,
  };
  let empties;
  let actual;
  try{
    empties=matchSaleEmpties(draft,fresh);
    if(draft.emptiesV2.mode==="exact"&&!hasConfirmedAllReturned(draft,empties))
      return {error:"Confirm that all expected empty crates and bottles came back, or enter the actual amounts returned."};
    assertSaleEmptiesResolved(empties);
    if(customerResult.data.empties_deposit_required&&empties.hasShortage)
      return {error:"This customer requires all expected empties to be returned. Deposit collection for shortages is not enabled yet."};
    actual=actualSaleEmpties(draft,fresh);
  }catch(cause){
    return {error:cause instanceof Error?cause.message:"Check the returned empty containers."};
  }

  const resolutions=new Map(empties.lines.map(line=>[line.productId,line]));
  const rpcLines=draft.lines.map(line=>{
    if(!line.reviewExpected) throw new Error("Review current prices and stock before saving.");
    const resolved=resolutions.get(line.productId);
    if(!resolved) throw new Error("Check the returned empties.");
    return {
      productId:line.productId,
      quantity:line.quantity,
      cratesTaken:cratesTakenFor(draft,line),
      returnedCrates:resolved.cratesSettled,
      returnedBottles:resolved.bottlesSettled,
      ...(empties.decisions.length?{
        emptyDecisions:empties.decisions.filter(choice=>choice.productId===line.productId),
      }:{}),
      expected:line.reviewExpected,
    };
  });

  const { data, error } = await supabase.rpc("save_business_sale_v2", {
    p_business_id: input.businessId, p_request_id: input.requestId,
    p_customer_id: input.customerId, p_business_date: input.businessDate,
    p_paid: input.paid, p_payment_method: input.paid > 0 ? input.paymentMethod : "not_recorded",
    p_lines: rpcLines,
    p_returned_crates: actual.crates,
    p_returned_bottles: actual.bottles,
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
  revalidatePath("/businesses/" + input.businessId + "/sales");
  return { result: data as { id: string; total: number; paid: number; owing: number; customer: string } };
}
