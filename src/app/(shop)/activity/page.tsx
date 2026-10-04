import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";

type Item = {
  id: string;
  day: string;
  created_at: string;
  kind: string;
  title: string;
  description: string;
  detail: string;
  sale_value: number;
  received: number;
};
type Feed = {
  count: number;
  sales_value: number;
  received: number;
  items: Item[];
};

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function eventLabel(item: Item) {
  if (item.kind === "sale") return "Sale";
  if (item.kind === "payment") return "Payment";
  if (item.kind === "stock")
    return item.description.startsWith("Received stock") ? "Stock received" : "Stock count";
  if (item.kind === "opening") return "Opening balance";
  return item.description.startsWith("Empty crate count")
    ? "Empty crate count"
    : "Empties returned";
}

function eventTime(createdAt: string) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

export default async function Activity({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const filters = await searchParams;
  const now = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const yesterday = shiftDay(now, -1);
  const sevenDaysAgo = shiftDay(now, -6);

  const from = /^\d{4}-\d{2}-\d{2}$/.test(filters.from ?? "")
    ? filters.from!
    : "0001-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(filters.to ?? "")
    ? filters.to!
    : now;
  const type = ["all", "sale", "payment", "stock", "empties", "opening"].includes(
    filters.type ?? "",
  )
    ? filters.type!
    : "all";
  const customer = /^[0-9a-f-]{36}$/i.test(filters.customer ?? "")
    ? filters.customer!
    : null;
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(filters.page ?? "1", 10) || 1),
  );
  const db = await requireOwner();
  const [feedResult, customersResult] = await Promise.all([
    db.rpc("store_activity", {
      p_from: from <= to ? from : to,
      p_to: to >= from ? to : from,
      p_customer: customer,
      p_type: type,
      p_limit: 30,
      p_offset: (page - 1) * 30,
    }),
    db.from("customers").select("id,name").order("name"),
  ]);
  if (feedResult.error || customersResult.error)
    throw new Error("Could not load store activity.");

  const feed = feedResult.data as Feed;
  const query = (next: number) =>
    `/activity?${new URLSearchParams({
      from,
      to,
      type,
      ...(customer ? { customer } : {}),
      page: String(next),
    })}`;
  const shortcut = (shortcutFrom: string, shortcutTo: string) =>
    `/activity?${new URLSearchParams({
      from: shortcutFrom,
      to: shortcutTo,
      type,
      ...(customer ? { customer } : {}),
    })}`;

  const grouped = Array.from(
    Map.groupBy(feed.items, (item) => item.day),
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Store history
        </p>
        <h1>Activity</h1>
        <p className="mt-1 text-stone-600">
          See what happened, when it happened and where money came from.
        </p>
      </header>

      <nav aria-label="Quick activity periods" className="flex flex-wrap gap-2">
        {[
          { label: "Today", href: shortcut(now, now), active: from === now && to === now },
          { label: "Yesterday", href: shortcut(yesterday, yesterday), active: from === yesterday && to === yesterday },
          { label: "Last 7 days", href: shortcut(sevenDaysAgo, now), active: from === sevenDaysAgo && to === now },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${item.active ? "border-emerald-900 bg-emerald-900 text-white" : "border-stone-200 bg-white text-stone-700"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <form
        action="/activity"
        className="grid grid-cols-2 gap-3 rounded-2xl border border-stone-200 bg-white p-4 md:grid-cols-4"
      >
        <div>
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <div>
          <label htmlFor="type">Activity</label>
          <select id="type" name="type" defaultValue={type}>
            <option value="all">All activity</option>
            <option value="sale">Sales</option>
            <option value="payment">Payments</option>
            <option value="stock">Stock</option>
            <option value="empties">Empties</option>
            <option value="opening">Opening balances</option>
          </select>
        </div>
        <div>
          <label htmlFor="customer">Customer</label>
          <select id="customer" name="customer" defaultValue={customer ?? ""}>
            <option value="">All customers</option>
            {customersResult.data.map((customerRow) => (
              <option key={customerRow.id} value={customerRow.id}>
                {customerRow.name}
              </option>
            ))}
          </select>
        </div>
        <button className="primary col-span-2 md:col-span-4">
          Show activity
        </button>
      </form>

      {from > to ? (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">
          “From” must be before “To”. Change the dates above.
        </p>
      ) : (
        <>
          <section
            className="grid grid-cols-2 gap-3"
            aria-label="Totals for selected filters"
          >
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-sm text-stone-600">Sales value</p>
              <strong className="text-xl">{formatNaira(feed.sales_value)}</strong>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-900">Money received</p>
              <strong className="text-xl text-emerald-950">
                {formatNaira(feed.received)}
              </strong>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">History</h2>
              <span className="text-sm text-stone-600">
                {feed.count} {feed.count === 1 ? "record" : "records"}
              </span>
            </div>

            {feed.items.length === 0 ? (
              <p className="rounded-xl border border-stone-200 bg-white p-5 text-stone-600">
                No activity matches these filters. Try a wider date range.
              </p>
            ) : (
              <div className="space-y-6">
                {grouped.map(([day, items]) => (
                  <section key={day} aria-labelledby={`activity-${day}`}>
                    <h3
                      id={`activity-${day}`}
                      className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500"
                    >
                      {day === now
                        ? "Today"
                        : day === yesterday
                          ? "Yesterday"
                          : formatBusinessDate(day)}
                    </h3>
                    <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
                      {items.map((item) => (
                        <li key={`${item.kind}-${item.id}`}>
                          <Link
                            href={item.detail}
                            className="flex min-h-20 items-center justify-between gap-4 p-4"
                          >
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                                <span>{eventLabel(item)}</span>
                                <time
                                  dateTime={item.created_at}
                                  className="font-medium normal-case tracking-normal text-stone-500"
                                >
                                  {eventTime(item.created_at)}
                                </time>
                              </span>
                              <strong className="mt-1 block break-words">
                                {item.title}
                              </strong>
                              {item.sale_value > 0 && (
                                <small className="text-stone-600">
                                  Sale value {formatNaira(item.sale_value)}
                                </small>
                              )}
                            </span>
                            <span className="shrink-0 text-right font-semibold">
                              {item.received > 0 ? formatNaira(item.received) : "→"}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>

          <nav aria-label="Activity pages" className="flex justify-between">
            {page > 1 ? (
              <Link className="quiet-link" href={query(page - 1)}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {page * 30 < feed.count && (
              <Link className="quiet-link" href={query(page + 1)}>
                Next →
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
