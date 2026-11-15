import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/domain/ids";
import { businessDateInLagos } from "@/domain/opening-business-date";
import type { SaleCatalog } from "@/domain/sale-builder";
import { BusinessSaleForm } from "./business-sale-form";

export default async function BusinessSalesPage({params}:{params:Promise<{businessId:string}>}) {
  const {businessId}=await params;
  if(!isUuid(businessId)) notFound();
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user) redirect("/sign-in?next=%2Fbusinesses");
  const {data:businesses,error:listError}=await supabase.rpc("list_my_businesses_for_setup");
  const business=businesses?.find(item=>item.business_id===businessId&&item.member_kind==="owner"&&item.business_status==="active");
  if(listError||!business) notFound();

  const salesUiEnabled = process.env.NEXT_PUBLIC_BUSINESS_SALES_ENABLED === "true";
  if (!salesUiEnabled) {
    return (
      <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
        <Link href="/businesses" className="quiet-link">← Your depots</Link>
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">{business.business_name} · Sales</p>
          <h1 className="text-2xl font-extrabold text-stone-950">Record a sale</h1>
        </header>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
          <h2 className="font-bold">Business sales are not enabled yet</h2>
          <p className="mt-2 text-sm text-stone-600">This screen is staged. The interface flag and the separate database sales gate must both be approved before a sale can be recorded.</p>
        </div>
      </section>
    );
  }

  const [pr,cr]=await Promise.all([
    supabase.from("products").select("id,business_id,name,size,image_url,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,is_active,crate_type_id,bottles_returnable,bottle_type,crate_type:crate_types!products_crate_type_id_fkey(business_id,name,is_legacy,pocket_count,empty_family),stock!stock_product_id_fkey(total_bottles)")
      .eq("business_id",businessId).eq("is_active",true).order("name").order("id"),
    supabase.from("customers").select("id,business_id,name,phone,empties_deposit_required")
      .eq("business_id",businessId).is("archived_at",null).order("name").order("id"),
  ]);
  if(pr.error||cr.error||pr.data?.some(p=>p.business_id!==businessId)||cr.data?.some(c=>c.business_id!==businessId))
    throw new Error("Could not verify this depot's sales catalogue.");

  const [crateResult,swapResult]=await Promise.all([
    supabase.from("crate_types").select("id,business_id,name,is_legacy,pocket_count")
      .eq("business_id",businessId).eq("is_legacy",false).order("name").order("id"),
    supabase.from("crate_swap_rules").select("business_id,owed_crate_type_id,returned_crate_type_id")
      .eq("business_id",businessId).order("owed_crate_type_id").order("returned_crate_type_id"),
  ]);
  if(crateResult.error||swapResult.error||
    crateResult.data?.some(row=>row.business_id!==businessId)||
    swapResult.data?.some(row=>row.business_id!==businessId))
    throw new Error("Could not verify this depot's empty-container rules.");

  const crateIds=new Set((crateResult.data??[]).map(crate=>crate.id));
  const catalog:SaleCatalog={
    products:(pr.data??[]).flatMap(p=>{
      const available=p.stock?.total_bottles??null;
      if(available===null||!Number.isSafeInteger(available)||available<0) return [];
      return [{
        id:p.id,name:p.name,size:p.size,image_url:p.image_url,
        bottles_per_crate:p.bottles_per_crate,
        full_crate_price:p.full_crate_price,half_crate_price:p.half_crate_price,
        quarter_crate_price:p.quarter_crate_price,bottle_price:p.bottle_price,
        available,crate_type_id:p.crate_type_id??"",
        crate_type:p.crate_type?{
          name:p.crate_type.name,is_legacy:p.crate_type.is_legacy,
          pocket_count:p.crate_type.pocket_count,empty_family:p.crate_type.empty_family,
        }:null,
        bottles_returnable:p.bottles_returnable,bottle_type:p.bottle_type,
      }];
    }),
    customers:(cr.data??[]).map(c=>({
      id:c.id,name:c.name,phone:c.phone,empties_deposit_required:c.empties_deposit_required,
    })),
    crateTypes:(crateResult.data??[]).map(({id,name,is_legacy,pocket_count})=>({id,name,is_legacy,pocket_count})),
    swapRules:(swapResult.data??[]).filter(rule=>crateIds.has(rule.owed_crate_type_id)&&crateIds.has(rule.returned_crate_type_id))
      .map(({owed_crate_type_id,returned_crate_type_id})=>({owed_crate_type_id,returned_crate_type_id})),
    bottleDepositPrice:null,
    crateDepositPrices:[],
  };

  return <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
    <Link href="/businesses" className="quiet-link">← Your depots</Link>
    <header className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">{business.business_name} · Sales</p>
      <h1 className="text-2xl font-extrabold text-stone-950">Record a sale</h1>
      <p className="text-sm leading-6 text-stone-600">This sale belongs only to {business.business_name}. Prices and stock are checked again when you save.</p>
    </header>
    {catalog.products.length===0||catalog.customers.length===0?<div className="rounded-2xl border border-stone-200 p-4">
      <h2 className="font-bold">This depot is not ready for sales</h2><p className="mt-2 text-sm text-stone-600">Add drinks, count their starting stock and register customers before recording a sale.</p>
      <Link href={"/businesses/" + businessId + "/drinks"} className="secondary mt-3 inline-flex min-h-11 items-center">Review drinks and stock</Link>
    </div>:<BusinessSaleForm businessId={businessId} businessDate={businessDateInLagos()} catalog={catalog} initialRequestId={randomUUID()}/>}
    <p className="text-xs leading-5 text-stone-500">First version limitations: full crates and loose bottles only; no partial crates, refundable deposit collection for shortages, mixed payment or old-debt collection in the same checkout. Crate and bottle swaps follow only the rules configured for this depot.</p>
  </section>;
}
