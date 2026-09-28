import { SuccessToast } from "@/components/success-toast";
import { CrateDisplay } from "@/components/crate-display";
import { crateNeedsSetup, showInDailyEmptyCrates } from "@/domain/crate-types";
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
  const currentProductTypes = new Set<string>();
  if (unresolved.length) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select("crate_type_id")
        .in("crate_type_id", unresolved.map((crate) => crate.crate_type_id!))
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load product crate types.");
      for (const product of data) currentProductTypes.add(product.crate_type_id);
      if (data.length < 1000) break;
    }
  }
  const visible = stock.data.filter(
    (crate) => showInDailyEmptyCrates(crate, currentProductTypes.has(crate.crate_type_id!)),
  );
  const groups = Map.groupBy(visible, (crate) =>
    crateNeedsSetup(crate) ? "Needs setup" : crate.empty_family!,
  );
  return (
    <>
      <h1>Empty Crates</h1>
      {params.saved === "1" && <SuccessToast message="Empty crate count saved." />}
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
                    <li key={item.crate_type_id} className="py-4">
                      <CrateDisplay crate={item} includeFamily={false} />
                      <p className="mt-2 text-lg font-semibold">
                        {item.quantity === null
                          ? "Not recorded"
                          : `Current: ${emptyCrateQuantity(item.quantity)}`}
                      </p>
                      <Link
                        className="secondary mt-3"
                        href={`/empty-crates/count?${new URLSearchParams({ type: item.crate_type_id })}`}
                        aria-label={`Set Current Count for ${item.name}`}
                      >
                        Set count
                      </Link>
                      {crateNeedsSetup(item) && (
                        <div className="mt-3 space-y-2 text-sm text-stone-600">
                          <p>
                            {currentProductTypes.has(item.crate_type_id)
                              ? "A current drink uses this older crate record. Create an exact crate type, then choose it on that drink."
                              : "This older crate record has a physical count. Its past records are kept for reference."}
                          </p>
                          <Link className="quiet-link" href="/crate-types">
                            Manage crate types
                          </Link>
                        </div>
                      )}
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
      <Link className="quiet-link mt-8 inline-block" href="/crate-types">
        Manage crate types
      </Link>
      <section className="mt-6" aria-labelledby="empty-history">
        <h2
          id="empty-history"
          className="text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Recent counts
        </h2>
        {!history.data?.length ? (
          <p className="mt-4 text-stone-600">No counts saved yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-stone-200 text-stone-700">
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
                <p>
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
