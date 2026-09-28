import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { productSearchFilter } from "@/domain/products";
import { crateFitsProduct, crateNeedsSetup } from "@/domain/crate-types";

import { ProductCard } from "@/components/product-card";

export default async function ProductsPage({
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
    .select(
      "id,name,size,image_url,bottles_per_crate,full_crate_price,bottle_price,crate_types(is_legacy,pocket_count,empty_family)",
      { count: "exact" },
    )
    .order("name")
    .order("id")
    .range((page - 1) * 30, page * 30 - 1);
  if (query) request = request.or(productSearchFilter(query));
  const { data, error, count } = await request;
  if (error) throw new Error("Could not load products.");
  const pageUrl = (value: number) =>
    `/products?${new URLSearchParams({ q: query, page: String(value) })}`;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1>Products</h1>
        <Link className="primary shrink-0" href="/products/new">Add product</Link>
      </div>
      <form action="/products" role="search" className="mb-4 mt-5">
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
          <Link href="/products" className="quiet-link inline-block">
            Clear search
          </Link>
        )}
      </form>
      <Link className="quiet-link mb-3 self-start text-sm" href="/crate-types">
        Manage crate types
      </Link>
      {!data?.length ? (
        <div className="border-t border-stone-300 py-8">
          <h2 className="text-xl font-semibold">
            {query ? "No matching products" : "No products yet"}
          </h2>
          <p className="mt-2 text-stone-600">
            {query
              ? "Try a different name or size."
              : "Add a drink to keep its prices and details here."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((product) => {
            const crate = product.crate_types;
            const needsSetup =
              !crate ||
              crateNeedsSetup({
                ...crate,
                id: null,
                crate_type_id: null,
                name: null,
                variant: null,
              }) ||
              !crateFitsProduct(crate.pocket_count, product.bottles_per_crate);
            return (
              <li key={product.id}>
                <ProductCard product={product} />
                {needsSetup && (
                  <p className="mt-2 border-l-4 border-amber-700 pl-3 text-sm text-amber-900">
                    Setup needed: finish the physical crate details before using this drink in a sale.
                  </p>
                )}
              </li>
            );
          })}
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
