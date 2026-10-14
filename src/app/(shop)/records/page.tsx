import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { RecordsFilterPanel } from "@/components/records-filter-panel";
import { formatBusinessDate } from "@/domain/sales";
import { methodLabel } from "@/lib/receipts";
import { RecordHistoryRow } from "@/components/record-history-row";
import {
  recordKinds, recordMethods, recordRanges, recordFilter, recordDates,
  recordPage, recordCursor, writeRecordCursor, recordTypeName,
  type CustomerRecordsFeed,
} from "@/domain/records";

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
  const cursor = recordCursor(params.cursor);
  const before = cursor !== null && params.dir === "before";
  const page = cursor ? recordPage(params.page) : 1;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const dates = recordDates(today, range, params.from, params.to);
  const customDates = Boolean(params.from || params.to);
  const db = await requireOwner();
  const { data, error } = dates.valid
    ? await db.rpc("customer_records", {
        p_from: dates.from, p_to: dates.to, p_kind: kind, p_method: method,
        p_search: query, p_limit: 30, p_cursor: cursor, p_before: before,
      })
    : { data: null, error: null };
  if (error) throw new Error("Could not load records. Please try again.");
  const feed = data as CustomerRecordsFeed | null;
  if (dates.valid && (!feed || !Array.isArray(feed.items) || typeof feed.count !== "number"))
    throw new Error("Could not load customer records.");

  const url = (changes: Record<string, string | undefined>) => {
    const values = {
      ...(query ? { q: query } : {}), ...(kind !== "all" ? { kind } : {}),
      ...(method !== "all" ? { method } : {}), range,
      ...(customDates ? { from: dates.from, to: dates.to } : {}),
      ...changes,
    };
    const args = new URLSearchParams(
      Object.entries(values).filter((entry): entry is [string,string] =>
        typeof entry[1] === "string" && entry[1].length > 0),
    );
    return "/records?" + args.toString();
  };
  const periodLabel = customDates ? `${dates.from || "From?"} – ${dates.to || "To?"}`
    : ({today:"Today","7d":"Last 7 days","30d":"Last 30 days",all:"All time"} as const)[range];
  const filterActive = Boolean(kind !== "all" || method !== "all" || customDates || range !== "30d");
  const groups = dates.valid && feed ? Array.from(Map.groupBy(feed.items, item => item.day)) : [];

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.15em] text-emerald-800">Business history</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Records</h1>
          <p className="mt-1.5 text-sm leading-6 text-stone-600">Every sale, payment and empties return, easy to find.</p>
        </div>
        <Link href="/record-sale" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800">
          <span aria-hidden="true" className="text-lg">+</span> Record sale
        </Link>
      </header>

      <div className="flex items-stretch gap-2" role="search" aria-label="Search saved records">
        <form action="/records" method="get" className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 shadow-sm transition focus-within:border-emerald-700 focus-within:ring-1 focus-within:ring-emerald-700">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-stone-500">
            <circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 5 5"/>
          </svg>
          <label htmlFor="records-search" className="sr-only">Search customer, business, phone or receipt number</label>
          <input id="records-search" name="q" type="search" maxLength={120} defaultValue={query}
            placeholder="Search customer or receipt"
            className="min-h-12 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !px-0 !py-2 !text-sm !shadow-none !outline-none focus:!outline-none focus-visible:!outline-none"
          />
          {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
          {method !== "all" && <input type="hidden" name="method" value={method} />}
          <input type="hidden" name="range" value={range}/>
          {customDates && <><input type="hidden" name="from" value={dates.from}/><input type="hidden" name="to" value={dates.to}/></>}
          <button type="submit" aria-label="Search records" className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-900 text-white transition hover:bg-emerald-800 focus-visible:outline-offset-2">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>
          </button>
        </form>
        <RecordsFilterPanel key={JSON.stringify({kind,method,range,from:dates.from,to:dates.to,query})} kind={kind} method={method} range={range} query={query}
          from={dates.from} to={dates.to} customDates={customDates}/>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex min-h-8 items-center rounded-full bg-stone-200/70 px-3 font-semibold text-stone-700">{periodLabel}</span>
        {kind !== "all" && <span className="inline-flex min-h-8 items-center rounded-full bg-emerald-100 px-3 font-semibold text-emerald-900">{recordTypeName(kind)}</span>}
        {method !== "all" && <span className="inline-flex min-h-8 items-center rounded-full bg-emerald-100 px-3 font-semibold text-emerald-900">{method === "not_recorded" ? "Method not recorded" : methodLabel(method)}</span>}
        {(filterActive || query) && <Link href="/records" className="inline-flex min-h-9 items-center px-2 font-semibold text-emerald-800 underline underline-offset-4">Clear all</Link>}
      </div>

      {!dates.valid ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
          <span>{dates.error}</span>
          <Link href="/records" className="font-bold underline underline-offset-4">Reset filters</Link>
        </div>
      ) : (
        <section aria-label="Saved customer records" className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-extrabold tracking-tight text-stone-950">
              {feed!.count.toLocaleString("en-NG")} {feed!.count === 1 ? "record" : "records"}
            </h2>
            <p className="text-xs font-medium text-stone-500">Newest first</p>
          </div>
          {feed!.items.length === 0 ? (
            <div className="flex flex-col items-center rounded-3xl border border-dashed border-stone-300 bg-white px-5 py-12 text-center">
              <span aria-hidden="true" className="mb-4 grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-800">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 3h14v18H5zM8 8h8M8 12h7M8 16h4"/></svg>
              </span>
              <h3 className="text-lg font-bold">No records found</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-stone-600">
                {query || filterActive ? "Try another name, receipt number or filter." : "Sales and payments will appear here after you save them."}
              </p>
              <Link href="/records" className="secondary mt-5">Show recent records</Link>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(([day, items]) => (
                <section key={day} aria-label={day === today ? "Today" : formatBusinessDate(day)}>
                  <div className="mb-2 flex items-center gap-2.5">
                    <h3 className="text-xs font-extrabold uppercase tracking-[.11em] text-stone-600">{day === today ? "Today" : formatBusinessDate(day)}</h3>
                    <div className="h-px flex-1 bg-stone-200"/>
                  </div>
                  <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_4px_18px_rgba(15,46,30,.035)]">
                    {items.map(item => <RecordHistoryRow key={item.kind+"-"+item.id} item={item}/>)}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {(page > 1 || feed!.has_more) && feed!.items.length > 0 && (
            <nav aria-label="Record pages" className="flex items-center justify-between gap-3 pt-2">
              {page > 1
                ? <Link className="secondary min-h-11 px-4" href={url({
                    page: String(page - 1), dir: "before", cursor: writeRecordCursor(feed!.items[0]),
                  })}>← Previous</Link>
                : <span/>}
              <span className="text-xs font-semibold text-stone-600">Page {page}</span>
              {(before || feed!.has_more)
                ? <Link className="secondary min-h-11 px-4" href={url({
                    page: String(page + 1), dir: "after", cursor: writeRecordCursor(feed!.items[feed!.items.length - 1]),
                  })}>Next →</Link>
                : <span/>}
            </nav>
          )}
          <div className="border-t border-stone-200 pt-3">
            <Link href="/activity" className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-emerald-800 hover:underline">
              Looking for stock movements? Shop activity <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
