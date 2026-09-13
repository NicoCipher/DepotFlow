import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { StockCard } from "@/components/stock-card";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; received?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  // Left embedding keeps products with no stock row visible. RLS applies to both tables.
  const { data, error, count } = await supabase
    .from("products")
    .select("id,name,size,image_url,bottles_per_crate,stock(total_bottles)", {
      count: "exact",
    })
    .order("name")
    .order("id")
    .range((page - 1) * 30, page * 30 - 1);
  if (error) throw new Error("Could not load stock.");
  return (
    <>
      <h1>Stock</h1>
      {params.received === "1" && (
        <p role="status" className="mt-3 text-emerald-900">
          Stock received.
        </p>
      )}
      <Link className="primary mt-5 w-full" href="/stock/receive">
        Add Stock
      </Link>
      <p className="mb-7 mt-3 text-stone-600">Full drinks in the shop.</p>
      {!data?.length ? (
        <div className="border-t border-stone-300 py-6">
          <h2 className="text-xl font-semibold">
            {page > 1 ? "No more products" : "No products yet"}
          </h2>
          {page === 1 && (
            <p className="mt-2 text-stone-600">
              Your products will appear here with their recorded stock.
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((product) => (
            <li key={product.id}>
              <StockCard
                product={product}
                totalBottles={product.stock?.total_bottles ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Stock pages" className="mt-4 flex justify-between">
        {page > 1 && (
          <Link className="quiet-link" href={`/stock?page=${page - 1}`}>
            Previous
          </Link>
        )}
        {(count ?? 0) > page * 30 && (
          <Link className="quiet-link ml-auto" href={`/stock?page=${page + 1}`}>
            Next
          </Link>
        )}
      </nav>
    </>
  );
}
