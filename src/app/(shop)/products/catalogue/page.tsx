import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatNaira } from "@/domain/products";
import { PageIntro } from "@/components/page-intro";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const query = typeof params.q === "string"
    ? params.q.trim().toLocaleLowerCase().slice(0, 120)
    : "";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [catalogue, assortment, history] = await Promise.all([
    supabase.from("product_catalogue").select("id,name,manufacturer").order("name").limit(1000),
    supabase.from("products").select("id,catalogue_product_id,full_crate_price").not("catalogue_product_id", "is", null).limit(1000),
    supabase.from("product_cost_history")
      .select("catalogue_product_id,cost_price,effective_on,recorded_at")
      .lte("effective_on", today)
      .order("effective_on", { ascending: false })
      .order("recorded_at", { ascending: false }).limit(1000),
  ]);
  if (catalogue.error || assortment.error || history.error) {
    throw new Error("Could not load the product catalogue.");
  }
  const configured = new Map(assortment.data.map((item) => [item.catalogue_product_id, item]));
  const currentCosts = new Map<string, { cost_price: number; effective_on: string }>();
  for (const cost of history.data) {
    if (!currentCosts.has(cost.catalogue_product_id)) currentCosts.set(cost.catalogue_product_id, cost);
  }
  const sellingPrices = new Map<string, { selling_price: number; effective_on: string | null }>();
  // Read every eligible page so busy products cannot hide another drink's price.
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabase.from("product_selling_price_history")
      .select("catalogue_product_id,selling_price,effective_on,recorded_at,edit_order")
      .lte("effective_on", today)
      .order("effective_on", { ascending: false })
      .order("recorded_at", { ascending: false })
      .order("edit_order", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (page.error) throw new Error("Could not load the product catalogue.");
    for (const price of page.data) {
      if (!sellingPrices.has(price.catalogue_product_id)) sellingPrices.set(price.catalogue_product_id, price);
    }
    if (page.data.length < pageSize) break;
  }
  const matches = catalogue.data.filter((item) => item.name.toLocaleLowerCase().includes(query));

  return (
    <>
      <Link href="/products" className="quiet-link">← Products</Link>
      <div className="mt-7">
        <PageIntro eyebrow="Product catalogue" title="Choose a drink"
          description="Choose a drink, check its selling price and complete its crate details to add it to your shop." />
      </div>
      <p className="text-sm text-stone-600">
        Crate details are completed during setup. Cost Price is what you pay to buy the drink; Selling Price is what you charge.
      </p>
      <form action="/products/catalogue" role="search" className="mt-6">
        <label htmlFor="catalogue-search">Find a drink</label>
        <div className="flex gap-2">
          <input id="catalogue-search" name="q" type="search" maxLength={120}
            defaultValue={query} className="min-w-0 flex-1" />
          <button className="secondary">Search</button>
        </div>
      </form>
      <Link href="/products/new" className="quiet-link mt-4 inline-block">Drink not listed? Add your own</Link>
      {matches.length === 0 ? (
        <p className="mt-8 text-stone-600">No matching drinks. Try another name.</p>
      ) : (
        <div className="mt-7 space-y-8">
          {(["NB", "GN", null] as const).map((group) => {
            const items = matches.filter((item) => item.manufacturer === group);
            if (!items.length) return null;
            return (
              <section key={group ?? "other"}>
                <h2 className="mb-3 text-xl font-semibold">
                  {group === "NB" ? "Nigerian Breweries" : group === "GN" ? "Guinness Nigeria" : "Other drinks"}
                </h2>
                <ul className="space-y-3">
                  {items.map((item) => {
                    const product = configured.get(item.id);
                    const cost = currentCosts.get(item.id);
                    const selling = sellingPrices.get(item.id);
                    return (
                      <li key={item.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{item.name}</h3>
                            <p className="mt-1 text-sm text-stone-600">
                              {product ? "Configured for this depot" : "Catalogue only · not set up for sales"}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs text-stone-600">Cost Price</p>
                            <p className="font-semibold">{cost ? formatNaira(cost.cost_price) : "Not recorded"}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-100 pt-3">
                          <p className="text-sm text-stone-600">Selling Price</p>
                          <p className="font-semibold">
                            {product ? formatNaira(product.full_crate_price)
                              : selling ? formatNaira(selling.selling_price) : "Not confirmed"}
                          </p>
                        </div>
                        {cost && <p className="mt-2 text-xs text-stone-600">Cost effective {cost.effective_on}</p>}
                        {selling && <p className="text-xs text-stone-600">Selling price effective {selling.effective_on}</p>}
                        {product ? <Link href={`/products/${product.id}/edit`} className="secondary mt-4 block text-center">Edit drink</Link>
                          : <Link href={`/products/new?catalogue=${item.id}`} className="primary mt-4 block text-center">Add this drink</Link>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
