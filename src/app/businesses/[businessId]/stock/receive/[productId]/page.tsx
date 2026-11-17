import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/domain/ids";
import { createClient } from "@/lib/supabase/server";
import { BusinessReceiveStockForm } from "@/components/business-receive-stock-form";
import { businessDateInLagos } from "@/domain/opening-business-date";

export default async function BusinessReceiveStockPage({
  params,
}: {
  params: Promise<{ businessId: string; productId: string }>;
}) {
  const { businessId, productId } = await params;
  if (!isUuid(businessId) || !isUuid(productId)) notFound();
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fbusinesses");
  const { data: businesses, error: listError } = await supabase.rpc("list_my_businesses_for_setup");
  const business = businesses?.find((item) =>
    item.business_id === businessId && item.member_kind === "owner" &&
    item.business_status === "active"
  );
  if (listError || !business) notFound();
  const { data: canReceive, error: gateError } = await supabase.rpc(
    "can_receive_business_stock", { p_business_id: businessId },
  );
  if (gateError || canReceive !== true) {
    return (
      <section className="mx-auto max-w-xl space-y-3">
        <Link href={`/businesses/${businessId}/stock`} className="quiet-link">← Current stock</Link>
        <h1 className="text-2xl font-bold">Stock receiving is not enabled</h1>
        <p className="text-sm text-stone-600">This depot can view stock, but receiving is still locked by its independent release gate.</p>
      </section>
    );
  }
  const { data: product, error } = await supabase.from("products")
    .select("id,business_id,name,size,bottles_per_crate,crate_type_id,is_active,crate_types(name),stock(total_bottles)")
    .eq("id", productId).eq("business_id", businessId).maybeSingle();
  if (error || !product || product.business_id !== businessId || !product.is_active) notFound();
  const { data: empty, error: emptyError } = await supabase.from("empty_crate_stock")
    .select("business_id,crate_type_id,quantity")
    .eq("business_id", businessId).eq("crate_type_id", product.crate_type_id).maybeSingle();
  if (emptyError || (empty && empty.business_id !== businessId)) {
    throw new Error("Could not verify matching empty crates.");
  }
  return (
    <section className="mx-auto w-full max-w-xl space-y-5 pb-8">
      <Link href={`/businesses/${businessId}/stock`} className="quiet-link">← Current stock</Link>
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">{business.business_name} · Receive stock</p>
        <h1 className="text-2xl font-extrabold">{product.name} {product.size}</h1>
        <p className="text-sm text-stone-600">{product.bottles_per_crate} bottles per crate. Receiving uses matching empty crates from this depot.</p>
      </header>
      <BusinessReceiveStockForm
        businessId={businessId}
        productId={productId}
        requestId={randomUUID()}
        businessDate={businessDateInLagos()}
        stock={product.stock?.total_bottles ?? 0}
        empties={empty?.quantity ?? 0}
        bottlesPerCrate={product.bottles_per_crate}
      />
    </section>
  );
}
