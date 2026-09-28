import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { StockProductChoice } from "@/components/stock-product-choice";
import { productSearchFilter } from "@/domain/products";

export default async function ChooseReceivingProductPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  let request = supabase
    .from("products")
    .select("id,name,size,image_url,bottles_per_crate", { count: "exact" })
    .order("name")
    .order("id")
    .range((page - 1) * 30, page * 30 - 1);
  if (query) request = request.or(productSearchFilter(query));
  const { data, error, count } = await request;
  if (error) throw new Error("Could not load products.");
  const pageUrl = (value: number) =>
    `/stock/receive?${new URLSearchParams({ q: query, page: String(value) })}`;
  return (
    <>
      <h1>Receive Stock</h1>
      <p className="mt-3">Choose the drink that came in.</p>
      <form action="/stock/receive" role="search" className="my-5">
        <label htmlFor="search">Search by name or size</label>
        <div className="flex gap-2">
          <input
            key={query}
            id="search"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={query}
            className="min-w-0 flex-1"
          />
          <button className="secondary">Search</button>
        </div>
        {query && (
          <Link href="/stock/receive" className="quiet-link inline-block">
            Clear search
          </Link>
        )}
      </form>
      {!data?.length ? (
        <div className="border-t border-stone-300 py-8">
          <h2 className="text-xl font-semibold">
            {query ? "No matching products" : "No products yet"}
          </h2>
          <p className="mt-2 text-stone-600">
            {query
              ? "Try a different name or size."
              : "Add a product before receiving stock."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((product) => (
            <li key={product.id}>
              <StockProductChoice product={product} action="receive" />
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Product pages" className="mt-4 flex justify-between">
        {page > 1 && (
          <Link className="quiet-link" href={pageUrl(page - 1)}>
            Previous
          </Link>
        )}
        {(count ?? 0) > page * 30 && (
          <Link className="quiet-link ml-auto" href={pageUrl(page + 1)}>
            Next
          </Link>
        )}
      </nav>
    </>
  );
}
