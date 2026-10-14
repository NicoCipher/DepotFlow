import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { methodLabel } from "@/lib/receipts";
import {
  recordKinds, recordMethods, recordRanges, recordFilter, recordDates,
  recordPage, recordSnapshot, recordStatus, recordTypeName, type CustomerRecordsFeed,
} from "@/domain/records";

const kindLabels = [
  { value: "all", label: "All records" },
  { value: "sale", label: "Sales" },
  { value: "payment", label: "Payments" },
  { value: "empties", label: "Empties" },
  { value: "opening", label: "Opening balances" },
] as const;

function eventTime(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function RecordIcon({ kind }: { kind: "sale" | "payment" | "empties" | "opening" }) {
  const path = {
    sale: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    payment: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M15 15h3" /></>,
    empties: <><path d="M8 3h8v4l2 2v11H6V9l2-2V3ZM8 7h8M9 14h6" /></>,
    opening: <><path d="M4 5h16v15H4zM8 10h8M8 14h4M9 5V3" /></>,
  }[kind];
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const kind = recordFilter(params.kind, recordKinds, "all");
  const method = recordFilter(params.method, recordMethods, "all");
  const range = recordFilter(params.range, recordRanges, "30d");
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const page = recordPage(params.page);
  const snapshot = recordSnapshot(params.snapshot);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const dates = recordDates(today, range, params.from, params.to);
  const customDates = Boolean(params.from && params.to);
  const db = await requireOwner();
  const { data, error } = dates.valid
    ? await db.rpc("customer_records", {
        p_from: dates.from, p_to: dates.to, p_kind: kind, p_method: method,
        p_search: query, p_limit: 30, p_offset: (page - 1) * 30,
        p_snapshot: snapshot,
      })
    : { data: null, error: null };
  if (error) throw new Error("Could not load records. Please try again.");
  const feed = data as CustomerRecordsFeed | null;
  if (dates.valid && (!feed || !Array.isArray(feed.items) || typeof feed.count !== "number"))
    throw new Error("Could not load customer records.");

  const url = (changes: Record<string, string | undefined>) => {
    const args = new URLSearchParams({
      ...(query ? { q: query } : {}), ...(kind !== "all" ? { kind } : {}),
      ...(method !== "all" ? { method } : {}), range,
      ...(customDates ? { from: dates.from, to: dates.to } : {}),
      ...changes,
    });
    for (const [key, value] of args) if (!value) args.delete(key);
    return "/records?" + args.toString();
  };

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-emerald-800">Customer history</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Records</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-stone-600">
            Find a sale, confirm a payment, or check empties returned. Every record links back to what was saved.
          </p>
        </div>
        <Link className="primary inline-flex min-h-12 items-center justify-center gap-2 px-5" href="/record-sale">
          <span aria-hidden="true" className="text-xl">+</span> Record sale
        </Link>
      </header>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Find records">
        <form action="/records" method="get" className="space-y-4">
          <div>
            <label htmlFor="record-search" className="mb-2 block text-sm font-semibold">Find a record</label>
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <input id="record-search" name="q" type="search" maxLength={120} defaultValue={query}
                placeholder="Customer, hotel, phone or receipt number"
                className="min-h-12 min-w-0 flex-1" />
              <button type="submit" className="primary min-h-12 px-5">Search</button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="record-type" className="mb-1 block text-sm font-semibold">Record type</label>
              <select id="record-type" name="kind" defaultValue={kind} className="min-h-12 w-full">
                {kindLabels.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="record-method" className="mb-1 block text-sm font-semibold">Payment method</label>
              <select id="record-method" name="method" defaultValue={method} className="min-h-12 w-full">
                <option value="all">Any method</option>
                <option value="cash">Cash</option>
                <option value="transfer">Bank transfer</option>
                <option value="pos">POS</option>
                <option value="not_recorded">Not recorded</option>
              </select>
            </div>
            <div>
              <label htmlFor="record-from" className="mb-1 block text-sm font-semibold">From</label>
              <input id="record-from" name="from" type="date" defaultValue={customDates ? dates.from : ""}
                className="min-h-12 w-full" />
            </div>
            <div>
              <label htmlFor="record-to" className="mb-1 block text-sm font-semibold">To</label>
              <input id="record-to" name="to" type="date" defaultValue={customDates ? dates.to : ""}
                className="min-h-12 w-full" />
            </div>
          </div>
          <input type="hidden" name="range" value={range} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-stone-500">Leave dates empty to use the selected quick period.</p>
            <button type="submit" className="secondary min-h-11 px-5">Apply filters</button>
          </div>
        </form>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Quick record dates">
        {([
          ["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"],
        ] as const).map(([value, label]) => {
          const active = !customDates && range === value;
          return <Link key={value} href={url({ range: value, from: undefined, to: undefined, page: undefined })}
            aria-current={active ? "page" : undefined}
            className={"inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold " +
              (active ? "border-emerald-900 bg-emerald-900 text-white" :
                "border-stone-200 bg-white text-stone-700 hover:border-emerald-700")}>{label}</Link>;
        })}
        {(query || kind !== "all" || method !== "all" || customDates) &&
          <Link href="/records" className="quiet-link inline-flex min-h-11 items-center px-2 text-sm">Clear filters</Link>}
      </nav>

      {!dates.valid ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-950">
          The start date cannot be after the end date. Change the dates and try again.
        </div>
      ) : (
        <section aria-label="Saved customer records">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Saved records</h2>
              <p className="mt-1 text-sm text-stone-600">{feed!.count.toLocaleString("en-NG")} matching {feed!.count === 1 ? "record" : "records"} · Newest first</p>
            </div>
            <Link href="/activity" className="quiet-link inline-flex min-h-11 items-center text-sm">Stock and other activity →</Link>
          </div>
          {feed!.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-5 py-10 text-center">
              <h3 className="text-xl font-semibold">No matching records</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-stone-600">
                {query || kind !== "all" || method !== "all" || customDates
                  ? "Try a different customer, receipt number, date or record type."
                  : "Your saved customer sales and payments will appear here."}
              </p>
              <Link href="/records" className="secondary mt-5 inline-flex min-h-11 items-center justify-center px-5">See recent records</Link>
            </div>
          ) : (
            <ul className="grid gap-3">
              {feed!.items.map((item) => {
                const hasMoney = item.kind === "sale" || item.kind === "payment";
                const label = recordTypeName(item.kind);
                return <li key={item.kind + "-" + item.id}>
                  <Link href={item.detail} className="group block rounded-2xl border border-stone-200 bg-white p-4 transition-colors hover:border-emerald-400 hover:bg-emerald-50/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 sm:p-5">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <span className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-xl " +
                        (item.kind === "payment" ? "bg-emerald-100 text-emerald-900" : item.kind === "sale" ?
                          "bg-blue-50 text-blue-900" : "bg-amber-50 text-amber-900")}>
                        <RecordIcon kind={item.kind} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <div className="min-w-0">
                            <p className="break-words text-base font-bold text-stone-950 sm:text-lg">{item.customer_name}</p>
                            {item.business_name && <p className="break-words text-sm text-stone-600">{item.business_name}</p>}
                          </div>
                          {hasMoney && <strong className="shrink-0 text-lg font-bold tabular-nums tracking-tight text-stone-950 sm:text-xl">
                            {formatNaira(item.kind === "sale" ? item.sale_total : item.received)}
                          </strong>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600 sm:text-sm">
                          <span className="font-semibold text-stone-800">{label}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={item.day}>{formatBusinessDate(item.day)}</time>
                          <span aria-hidden="true">·</span>
                          <time dateTime={item.created_at}>{eventTime(item.created_at)}</time>
                          {item.receipt_number && <><span aria-hidden="true">·</span>
                            <span className="break-all">{item.receipt_number}</span></>}
                        </div>
                        {item.kind === "sale" && <p className="mt-2 text-sm leading-6 text-stone-700">
                          {item.received > 0 ? `Received ${formatNaira(item.received)}` : "No payment received"}{item.received > 0 && item.method ? ` · ${methodLabel(item.method)}` : ""}
                          {item.remaining > 0 ? ` · ${formatNaira(item.remaining)} unpaid on this sale` : ""}
                        </p>}
                        {item.kind === "payment" && <p className="mt-2 text-sm leading-6 text-stone-700">
                          {methodLabel(item.method ?? "not_recorded")} · Customer balance after: {formatNaira(item.remaining)}
                        </p>}
                        {item.kind === "empties" && <p className="mt-2 text-sm leading-6 text-stone-700">
                          Returned: {item.crates} {item.crates === 1 ? "crate" : "crates"} and {item.bottles} {item.bottles === 1 ? "bottle" : "bottles"}
                          {(item.held_crates > 0 || item.held_bottles > 0) &&
                            ` · Customer collected ${item.held_crates} held crates, ${item.held_bottles} held bottles`}
                        </p>}
                        {item.kind === "opening" && <p className="mt-2 text-sm leading-6 text-stone-700">
                          Starting balance: {formatNaira(item.remaining)} · {item.crates} crates and {item.bottles} bottles entered
                        </p>}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
                          <span className={"rounded-full px-3 py-1 text-xs font-semibold " +
                            (item.status === "voided" ? "bg-red-100 text-red-900" :
                              item.status === "unpaid" || item.status === "partial" ? "bg-amber-100 text-amber-950" :
                                item.kind === "payment" ? "bg-emerald-100 text-emerald-900" : "bg-stone-100 text-stone-700")}>
                            {recordStatus(item.kind, item.status)}
                          </span>
                          <span className="text-sm font-semibold text-emerald-900 group-hover:underline">
                            {item.kind === "sale" ? item.received > 0 ? "View sale receipt" : "View sale record" :
                              item.kind === "payment" ? "View payment receipt" : "View details"} <span aria-hidden="true">→</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>;
              })}
            </ul>
          )}
          {(feed!.count > 30) && <nav aria-label="Record pages" className="mt-5 flex items-center justify-between gap-3">
            {page > 1 ? <Link className="secondary inline-flex min-h-11 items-center px-4" href={url({ page: String(page - 1), snapshot: feed!.snapshot })}>← Previous</Link> : <span />}
            <span className="text-sm text-stone-600">Page {page}</span>
            {page * 30 < feed!.count ? <Link className="secondary inline-flex min-h-11 items-center px-4" href={url({ page: String(page + 1), snapshot: feed!.snapshot })}>Next →</Link> : <span />}
          </nav>}
        </section>
      )}
      <p className="text-xs leading-5 text-stone-500">Sales show their saved value and payment toward that sale. Separate debt payments appear only as payments. Empties are physical records, not cash receipts.</p>
    </div>
  );
}
