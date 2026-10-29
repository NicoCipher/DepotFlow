import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { PriceEditor, type PriceEditorRow } from "@/components/price-editor";

export default async function ProductPricesPage() {
  const supabase = await requireOwner();
  const { data: businessId, error: scopeError } = await supabase.rpc("get_legacy_price_editor_business_id");
  if (scopeError || !businessId) {
    throw new Error("Price updates are not enabled for this shop yet.");
  }
  const { data: businessProfile, error: businessProfileError } = await supabase
    .from("business_profiles").select("name").eq("business_id", businessId).maybeSingle();
  if (businessProfileError || !businessProfile?.name) {
    throw new Error("Could not confirm which shop these prices belong to.");
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const products: {
    id: string; name: string; size: string | null; bottles_per_crate: number;
    full_crate_price: number; half_crate_price: number | null; quarter_crate_price: number | null;
    bottle_price: number | null; catalogue_product_id: string | null; business_id: string | null;
  }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await supabase.from("products")
      .select("id,name,size,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,catalogue_product_id,business_id")
      .eq("is_active", true).eq("business_id", businessId).order("name").order("id")
      .range(offset, offset + 999);
    if (page.error) throw new Error("Could not load drink prices.");
    products.push(...page.data);
    if (page.data.length < 1000) break;
    if (products.length >= 5000) throw new Error("The price list is too large to load safely.");
  }

  const costs = new Map<string, number>();
  const catalogueIds = [...new Set(products
    .filter((product) => product.catalogue_product_id !== null)
    .map((product) => product.catalogue_product_id!))];
  if (catalogueIds.length > 0) {
    for (let offset = 0; ; offset += 1000) {
      const page = await supabase.from("product_cost_history")
        .select("catalogue_product_id,cost_price,effective_on,recorded_at,business_id,id")
        .in("catalogue_product_id", catalogueIds)
        .eq("business_id", businessId)
        .lte("effective_on", today)
        .order("effective_on", { ascending: false })
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 999);
      if (page.error) throw new Error("Could not load buying costs.");
      for (const item of page.data) {
        const key = `${item.business_id ?? "legacy"}:${item.catalogue_product_id}`;
        if (!costs.has(key)) costs.set(key, item.cost_price);
      }
      if (page.data.length < 1000) break;
    }
  }

  const rows: PriceEditorRow[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    size: product.size,
    bottlesPerCrate: product.bottles_per_crate,
    fullCratePrice: product.full_crate_price,
    halfCratePrice: product.half_crate_price,
    quarterCratePrice: product.quarter_crate_price,
    bottlePrice: product.bottle_price,
    catalogueProductId: product.catalogue_product_id,
    costPrice: product.catalogue_product_id
      ? costs.get(`${product.business_id ?? "legacy"}:${product.catalogue_product_id}`) ?? null
      : null,
  }));

  return (
    <>
      <Link href="/products" className="quiet-link">← Drinks</Link>
      <h1 className="mt-5">Update prices</h1>
      <p className="mt-1 font-semibold">{businessProfile.name}</p>
      <p className="mt-2 text-sm text-stone-600">
        Change only what you need. Buying cost and selling prices are separate.
      </p>
      {rows.length ? <PriceEditor initialRows={rows} /> : (
        <p className="mt-6 text-stone-600">No active drinks to update.</p>
      )}
    </>
  );
}
