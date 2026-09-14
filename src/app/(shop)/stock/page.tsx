import { crateLabel } from "@/domain/crate-types";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatQuantity } from "@/domain/quantity";
import { StockCard } from "@/components/stock-card";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; received?: string; counted?: string }>;
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
  const history = await supabase
    .from("stock_movements")
    .select(
      "id,crate_types(*),product_name,movement_type,quantity_change,resulting_stock,business_date,bottles_per_crate",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(20);
  if (history.error) throw new Error("Could not load stock history.");
  return (
    <>
      <h1>Stock</h1>
      {params.received === "1" && (
        <p role="status" className="mt-3 text-emerald-900">
          Stock received.
        </p>
      )}
      <Link className="primary mt-5 w-full" href="/stock/receive">
        Receive Stock
      </Link>
      <Link className="secondary mt-3 w-full" href="/stock/count">
        Set Current Stock
      </Link>
      {params.counted === "1" && (
        <p role="status" className="mt-3 text-emerald-900">
          Current stock saved.
        </p>
      )}
      <Link className="secondary mt-3 w-full" href="/empty-crates">
        Empty Crates
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
      <section className="mt-10" aria-labelledby="history-title">
        <h2 id="history-title" className="text-xl font-semibold">
          Recent stock history
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Latest 20 saved entries. Dates are the business dates you chose.
        </p>
        {!history.data?.length ? (
          <p className="mt-4">No stock history yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-stone-200">
            {history.data.map((movement) => (
              <li key={movement.id} className="space-y-2 py-5">
                <time
                  dateTime={movement.business_date}
                  className="text-sm text-stone-600"
                >
                  {new Intl.DateTimeFormat("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(`${movement.business_date}T00:00:00Z`))}
                </time>
                <h3 className="break-words font-semibold">
                  {movement.product_name}
                </h3>
                {movement.crate_types && (
                  <p className="text-sm text-stone-600">
                    {crateLabel(movement.crate_types)}
                  </p>
                )}
                <p>
                  {movement.movement_type === "receive"
                    ? "Stock received"
                    : "Current stock counted"}
                </p>
                <p>
                  Change:{" "}
                  {movement.quantity_change === 0
                    ? "No change"
                    : `${movement.quantity_change > 0 ? "+" : "−"}${formatQuantity(Math.abs(movement.quantity_change), movement.bottles_per_crate)}`}
                </p>
                <p className="font-semibold">
                  Stock after:{" "}
                  {formatQuantity(
                    movement.resulting_stock,
                    movement.bottles_per_crate,
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
