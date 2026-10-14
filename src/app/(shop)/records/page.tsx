import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { RecordsFilterPanel } from "@/components/records-filter-panel";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { methodLabel } from "@/lib/receipts";
import {
  recordKinds, recordMethods, recordRanges, recordFilter, recordDates,
  recordPage, recordCursor, writeRecordCursor, recordStatus, recordTypeName,
  type CustomerRecord, type CustomerRecordsFeed,
} from "@/domain/records";

function eventTime(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function RecordIcon({ kind }: { kind: CustomerRecord["kind"] }) {
  return (
    <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {kind === "sale" ? <><path d="M7 3h10l2 2v16l-3-2-4 2-4-2-3 2V5z" /><path d="M9 9h6M9 13h6"/></>
      : kind === "payment" ? <><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 15h2"/></>
      : kind === "empties" ? <><path d="M7 8 12 5l5 3v11l-5 3-5-3zM7 8l5 3 5-3M12 11v11M9 3h6"/></>
      : <><path d="M7 3h10v18H7zM10 8h4M10 12h4M10 16h2"/></>}
    </svg>
  );
}

function RecordRow({ item }: { item: CustomerRecord }) {
  const sale = item.kind === "sale";
  const payment = item.kind === "payment";
  const combinedCheckout = sale && item.old_debt_paid > 0;
  const paymentDuringSale = payment && Boolean(item.linked_sale_id);
  const empties = item.kind === "empties";
  const heldOnly = empties && item.crates === 0 && item.bottles === 0
    && (item.held_crates > 0 || item.held_bottles > 0);
  const unpaid = sale && item.remaining > 0;
  const visual = item.status === "voided" ? "bg-red-50 text-red-800"
    : payment ? "bg-emerald-100 text-emerald-800"
      : sale ? "bg-sky-100 text-sky-800"
        : empties ? "bg-amber-100 text-amber-900" : "bg-violet-100 text-violet-800";
  return (
    <li>
      <Link href={item.kind === "opening" ? `/records/opening/${item.id}` : item.detail}
        className="group flex min-h-28 items-start gap-3 px-4 py-4 transition-colors hover:bg-emerald-50/50 focus-visible:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-emerald-700 sm:items-center sm:gap-4 sm:px-6 sm:py-5">
        <span className={`mt-0.5 grid size-11 shrink-0 place-items-center rounded-2xl ${visual} sm:mt-0`}>
          <RecordIcon kind={item.kind}/>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-bold uppercase tracking-[.08em] text-stone-500">{heldOnly ? "Held empties collected" : combinedCheckout ? "Sale & debt payment" : paymentDuringSale ? "Payment during purchase" : recordTypeName(item.kind)}</span>
            <span className="text-xs text-stone-400">·</span>
            <time dateTime={item.created_at} className="text-xs text-stone-500">{eventTime(item.created_at)}</time>
          </div>
          <p className="mt-1 break-words text-[15px] font-bold leading-snug text-stone-950 sm:text-base">{item.customer_name}</p>
          {item.business_name && item.business_name !== item.customer_name &&
            <p className="mt-0.5 break-words text-xs text-stone-500">{item.business_name}</p>}
          <p className="mt-2 text-xs leading-relaxed text-stone-600 sm:text-sm">
            {sale ? (
              <>
                {combinedCheckout ? (
                  <>
                    <span className="block">New sale {formatNaira(item.sale_total)}{item.method ? ` · ${methodLabel(item.method)}` : ""}</span>
                    <span className="mt-1 block">Old debt paid {formatNaira(item.old_debt_paid)} · Paid on this sale {formatNaira(item.received)}</span>
                    <span className="mt-1 block font-semibold text-stone-700">Customer still owes {formatNaira(item.checkout_balance ?? 0)} after this checkout</span>
                  </>
                ) : (
                  <>
                    {item.received > 0
                      ? `Received ${formatNaira(item.received)}${item.method ? ` via ${methodLabel(item.method)}` : ""}`
                      : "No money received"}
                    {unpaid && <span className="font-semibold text-amber-800"> · {formatNaira(item.remaining)} still unpaid</span>}
                  </>
                )}
              </>
            )  : payment ? `${methodLabel(item.method ?? "not_recorded")} · ${paymentDuringSale ? "Included in a sale checkout · " : ""}Balance after: ${formatNaira(item.remaining)}`
              : empties ? `${item.crates || item.bottles ? `Returned: ${item.crates} ${item.crates === 1 ? "crate" : "crates"} and ${item.bottles} ${item.bottles === 1 ? "bottle" : "bottles"}` : ""}${(item.held_crates || item.held_bottles) ? `${item.crates || item.bottles ? " · " : ""}Customer collected ${item.held_crates} held crates and ${item.held_bottles} held bottles` : ""}`
                : `${formatNaira(item.remaining)} starting money owed · ${item.crates} crates, ${item.bottles} bottles`}
          </p>
          {item.receipt_number && <p className="mt-1.5 break-all text-[11px] tracking-wide text-stone-400">{item.receipt_number}</p>}
        </div>
        <div className="flex max-w-[42%] shrink-0 flex-col items-end gap-2 self-stretch justify-center text-right sm:gap-3">
          {combinedCheckout && <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500">Collected now</span>}
          <strong className={`text-base font-extrabold tabular-nums tracking-tight sm:text-xl ${unpaid ? "text-stone-950" : payment ? "text-emerald-900" : "text-stone-950"}`}>
            {sale ? formatNaira(combinedCheckout ? item.checkout_received : item.sale_total)
              : payment ? formatNaira(item.received)
                : empties ? (item.crates > 0 ? `${item.crates} ${item.crates === 1 ? "crate" : "crates"}`
                : item.bottles > 0 ? `${item.bottles} ${item.bottles === 1 ? "bottle" : "bottles"}`
                  : item.held_crates > 0 ? `${item.held_crates} held crates` : `${item.held_bottles} held bottles`)
              : formatNaira(item.remaining)}
          </strong>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold leading-tight ${
            item.status === "voided" ? "bg-red-100 text-red-900" :
              unpaid ? "bg-amber-100 text-amber-900" :
                payment ? "bg-emerald-100 text-emerald-900" : "bg-stone-100 text-stone-700"
          }`}>{combinedCheckout && item.status !== "voided"
            ? item.checkout_balance === 0 ? "Account settled" : "Balance outstanding"
            : recordStatus(item.kind, item.status)}</span>
          <span className="hidden items-center gap-1 text-xs font-semibold text-emerald-800 group-hover:underline sm:inline-flex">
            {sale || payment ? "Receipt" : "Details"} <span aria-hidden="true">→</span>
          </span>
        </div>
      </Link>
    </li>
  );
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
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight text-stone-950">Saved history</h2>
              <p className="mt-0.5 text-xs text-stone-600">{feed!.count.toLocaleString("en-NG")} {feed!.count === 1 ? "record" : "records"} · Newest first</p>
            </div>
            <Link href="/activity" className="inline-flex min-h-10 items-center gap-1 text-xs font-bold text-emerald-800 hover:underline">Shop activity <span aria-hidden="true">↗</span></Link>
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
            <div className="space-y-5">
              {groups.map(([day, items]) => (
                <section key={day} aria-label={day === today ? "Today" : formatBusinessDate(day)}>
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="text-xs font-extrabold uppercase tracking-[.11em] text-stone-600">{day === today ? "Today" : formatBusinessDate(day)}</h3>
                    <div className="h-px flex-1 bg-stone-200"/>
                  </div>
                  <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_4px_22px_rgba(15,46,30,.035)]">
                    {items.map(item => <RecordRow key={item.kind+"-"+item.id} item={item}/>)}
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
        </section>
      )}
    </div>
  );
}
