import { CrateDisplay } from "@/components/crate-display";
import { crateNeedsSetup } from "@/domain/crate-types";
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
      .select("*", { count: "exact" })
      .order("empty_family", { nullsFirst: false })
      .order("name")
      .order("crate_type_id")
      .range((page - 1) * 30, page * 30 - 1),
    supabase
      .from("empty_crate_movements")
      .select(
        "id,crate_type_id,crate_types(*),previous_quantity,quantity_change,resulting_quantity,business_date",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20),
  ]);
  if (stock.error || history.error)
    throw new Error("Could not load empty crates.");
  const unresolved = stock.data.filter(
    (crate) => crateNeedsSetup(crate) && crate.crate_type_id !== null,
  );
  const relevant = new Set<string>();
  if (unresolved.length) {
    const { data, error } = await supabase
      .from("crate_types")
      .select(
        "id,products(count),empty_crate_movements(count),stock_movements(count),sale_items(count),crate_obligations(count)",
      )
      .in(
        "id",
        unresolved.map((crate) => crate.crate_type_id!),
      );
    if (error) throw new Error("Could not load crate types.");
    for (const crate of data)
      if (
        [
          crate.products,
          crate.empty_crate_movements,
          crate.stock_movements,
          crate.sale_items,
          crate.crate_obligations,
        ].some((rows) => rows[0]?.count > 0)
      )
        relevant.add(crate.id);
  }
  const visible = stock.data.filter(
    (crate) =>
      !crateNeedsSetup(crate) ||
      crate.quantity !== null ||
      relevant.has(crate.crate_type_id!),
  );
  const groups = Map.groupBy(visible, (crate) =>
    crateNeedsSetup(crate) ? "Needs setup" : crate.empty_family!,
  );
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
      <Link className="quiet-link mt-4" href="/crate-types">
        Manage crate types
      </Link>
      {!visible.length && <p className="mt-6">No crate counts to show.</p>}
      {Array.from(groups)
        .sort(([a], [b]) =>
          a === "Needs setup"
            ? 1
            : b === "Needs setup"
              ? -1
              : a.localeCompare(b),
        )
        .map(([family, crates]) => (
          <section key={family} className="mt-7">
            <h2 className="text-xl font-semibold">{family}</h2>
            <ul className="divide-y divide-stone-200">
              {crates.map(
                (item) =>
                  item.crate_type_id && (
                    <li key={item.crate_type_id} className="py-5">
                      <CrateDisplay crate={item} includeFamily={false} />
                      <p className="mt-2 text-lg">
                        {emptyCrateQuantity(item.quantity)}
                      </p>
                      <Link
                        className="primary mt-4 w-full"
                        href={`/empty-crates/count?${new URLSearchParams({ type: item.crate_type_id })}`}
                        aria-label={`Set Current Count for ${item.name}`}
                      >
                        Set Current Count
                      </Link>
                    </li>
                  ),
              )}
            </ul>
          </section>
        ))}
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
                <h3 className="break-words font-semibold">
                  <CrateDisplay crate={item.crate_types} />
                </h3>
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
