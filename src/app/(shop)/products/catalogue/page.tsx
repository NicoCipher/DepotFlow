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
      <Link href="/products" className="quiet-link">← Drinks</Link>
      <div className="mt-7">
        <PageIntro eyebrow="Drink catalogue" title="Choose a drink"
          description="Choose a drink, check its selling price and complete its crate details to add it to your shop." />
      </div>
      <p className="text-sm text-stone-600">
        Crate details are completed during setup. Buying cost is what you pay for the drink; selling price is what you charge.
      </p>
      <form action="/products/catalogue" role="search" className="mt-6">
        <label htmlFor="catalogue-search">Find a drink</label>
        <div className="flex gap-2">
          <input key={query} id="catalogue-search" name="q" type="search" maxLength={120}
            defaultValue={query} className="min-w-0 flex-1" />
          <button className="secondary">Search</button>
        </div>
        {query && <Link href="/products/catalogue" className="quiet-link inline-flex">Clear search</Link>}
      </form>
      <Link href="/products/new" className="quiet-link mt-4 inline-block">Drink not listed? Add your own</Link>
      {matches.length === 0 ? (
        <p className="mt-8 text-stone-600">No matching drinks. Try another name.</p>
      ) : (
        <div className="mt-7 space-y-8">
          {(["NB", "GN", null] as const).map((group) => {
            const items = matches.filter((item) => group === null ? item.manufacturer !== "NB" && item.manufacturer !== "GN" : item.manufacturer === group);
            if (!items.length) return null;
            return (
              <section key={group ?? "other"}>
                <h2 className="mb-3 text-xl font-semibold">
                  {group === "NB" ? "Nigerian Breweries" : group === "GN" ? "Guinness Nigeria" : "Other drinks"}
                </h2>
                <ul className="grid gap-4 md:grid-cols-2">
                  {items.map((item) => {
                    const product = configured.get(item.id);
                    const cost = currentCosts.get(item.id);
                    const selling = sellingPrices.get(item.id);
                    return (
                      <li key={item.id} className={`rounded-2xl border bg-white p-4 ${product ? "border-emerald-200" : "border-stone-200"}`}>
                        <h3 className="break-words text-lg font-semibold">{item.name}</h3>
                        <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${product ? "bg-emerald-50 text-emerald-900" : "bg-stone-100 text-stone-700"}`}>
                          {product ? "In your shop" : "Not added yet"}
                        </span>
                        <dl className="mt-4 space-y-3 border-t border-stone-200 pt-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <dt className="text-sm text-stone-600">Selling price</dt>
                            <dd className="font-semibold">
                              {product ? formatNaira(product.full_crate_price)
                                : selling ? formatNaira(selling.selling_price) : "Enter during setup"}
                            </dd>
                          </div>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <dt className="text-sm text-stone-600">Buying cost</dt>
                            <dd>{cost ? formatNaira(cost.cost_price) : "Not recorded"}</dd>
                          </div>
                        </dl>
                        {cost && <p className="mt-3 text-xs text-stone-600">Buying cost from {cost.effective_on}</p>}
                        {!product && selling && <p className="text-xs text-stone-600">Selling price from {selling.effective_on}</p>}
                        {product ? <Link href={`/products/${product.id}/edit`} className="secondary mt-4 w-full">Edit drink</Link>
                          : <Link href={`/products/new?catalogue=${item.id}`} className="primary mt-4 w-full">Add this drink</Link>}
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
