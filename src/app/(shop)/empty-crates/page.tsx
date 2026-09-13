import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { emptyCrateQuantity } from "@/domain/empty-crates";

export default async function EmptyCratesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; saved?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  const [stock, history] = await Promise.all([
    supabase
      .from("known_empty_crates")
      .select("crate_type,quantity", { count: "exact" })
      .order("crate_type")
      .range((page - 1) * 30, page * 30 - 1),
    supabase
      .from("empty_crate_movements")
      .select(
        "id,crate_type,previous_quantity,quantity_change,resulting_quantity,business_date",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20),
  ]);
  if (stock.error || history.error)
    throw new Error("Could not load empty crates.");
  return (
    <>
      <h1>Empty Crates</h1>
      <p className="mt-3 text-stone-600">
        Empty crates physically in the shop. Choose a type to set its current
        count.
      </p>
      {params.saved === "1" && (
        <p role="status" className="mt-3 text-emerald-900">
          Empty-crate count saved.
        </p>
      )}
      {!stock.data?.length ? (
        <div className="mt-6 border-t border-stone-300 py-6">
          <h2 className="text-xl font-semibold">
            {page > 1 ? "No more crate types" : "No crate types yet"}
          </h2>
          <p className="mt-2">
            Crate types configured on your products appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-stone-200">
          {stock.data.map(
            (item) =>
              item.crate_type !== null && (
                <li key={item.crate_type} className="py-5">
                  <h2 className="break-words text-xl font-semibold">
                    {item.crate_type}
                  </h2>
                  <p className="mt-2 text-lg">
                    {emptyCrateQuantity(item.quantity)}
                  </p>
                  <Link
                    className="primary mt-4 w-full"
                    href={`/empty-crates/count?${new URLSearchParams({ type: item.crate_type })}`}
                    aria-label={`Set Current Count for ${item.crate_type}`}
                  >
                    Set Current Count
                  </Link>
                </li>
              ),
          )}
        </ul>
      )}
      <nav aria-label="Crate type pages" className="mt-4 flex justify-between">
        {page > 1 && (
          <Link className="quiet-link" href={`/empty-crates?page=${page - 1}`}>
            Previous
          </Link>
        )}
        {(stock.count ?? 0) > page * 30 && (
          <Link
            className="quiet-link ml-auto"
            href={`/empty-crates?page=${page + 1}`}
          >
            Next
          </Link>
        )}
      </nav>
      <section className="mt-10" aria-labelledby="empty-history">
        <h2 id="empty-history" className="text-xl font-semibold">
          Recent counts
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Latest 20 saved counts, with the business dates you chose.
        </p>
        {!history.data?.length ? (
          <p className="mt-4">No counts saved yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-stone-200">
            {history.data.map((item) => (
              <li key={item.id} className="space-y-2 py-5">
                <time
                  dateTime={item.business_date}
                  className="text-sm text-stone-600"
                >
                  {new Intl.DateTimeFormat("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(`${item.business_date}T00:00:00Z`))}
                </time>
                <h3 className="break-words font-semibold">{item.crate_type}</h3>
                <p>
                  {item.previous_quantity === null
                    ? "Initial count — previously not recorded"
                    : `Previous count: ${emptyCrateQuantity(item.previous_quantity)}`}
                </p>
                {item.previous_quantity !== null && (
                  <p>
                    Change:{" "}
                    {item.quantity_change === 0
                      ? "No change"
                      : `${item.quantity_change > 0 ? "+" : "−"}${emptyCrateQuantity(Math.abs(item.quantity_change))}`}
                  </p>
                )}
                <p className="font-semibold">
                  Count saved: {emptyCrateQuantity(item.resulting_quantity)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link className="quiet-link mt-5 inline-block" href="/stock">
        Back to Stock
      </Link>
    </>
  );
}
