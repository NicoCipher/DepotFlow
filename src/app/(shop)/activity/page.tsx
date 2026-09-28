import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";

type Item = { id: string; day: string; kind: string; title: string; description: string; detail: string; sale_value: number; received: number };
type Feed = { count: number; sales_value: number; received: number; items: Item[] };
export default async function Activity({ searchParams }: { searchParams: Promise<Record<string,string | undefined>> }) {
  const filters = await searchParams;
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(filters.from ?? "") ? filters.from! : "0001-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(filters.to ?? "") ? filters.to! : now;
  const type = ["all","sale","payment","stock","empties"].includes(filters.type ?? "") ? filters.type! : "all";
  const customer = /^[0-9a-f-]{36}$/i.test(filters.customer ?? "") ? filters.customer! : null;
  const page = Math.max(1, Math.min(100000, Number.parseInt(filters.page ?? "1",10) || 1));
  const db = await requireOwner();
  const [feedResult, customersResult] = await Promise.all([
    db.rpc("store_activity", { p_from: from <= to ? from : to, p_to: to >= from ? to : from, p_customer: customer, p_type: type, p_limit: 30, p_offset: (page-1)*30 }),
    db.from("customers").select("id,name").order("name"),
  ]);
  if (feedResult.error || customersResult.error) throw new Error("Could not load store activity.");
  const feed = feedResult.data as Feed;
  const query = (next: number) => `/activity?${new URLSearchParams({ from,to,type, ...(customer ? { customer } : {}), page: String(next) })}`;
  return <div className="space-y-6"><header><p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Store history</p><h1>Activity</h1><p className="mt-1 text-stone-600">See what happened and where money came from.</p></header>
    <form action="/activity" className="grid grid-cols-2 gap-3 rounded-2xl border border-stone-200 bg-white p-4">
      <div><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} /></div><div><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} /></div>
      <div><label htmlFor="type">Activity</label><select id="type" name="type" defaultValue={type}><option value="all">All activity</option><option value="sale">Sales</option><option value="payment">Payments</option><option value="stock">Stock</option><option value="empties">Empties</option></select></div>
      <div><label htmlFor="customer">Customer</label><select id="customer" name="customer" defaultValue={customer ?? ""}><option value="">All customers</option>{customersResult.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <button className="primary col-span-2">Show activity</button>
    </form>
    {from > to ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">“From” must be before “To”. Change the dates above.</p> : <>
      <section className="grid grid-cols-2 gap-3" aria-label="Totals for selected filters"><div className="rounded-xl bg-white p-4"><p className="text-sm text-stone-600">Sales value</p><strong className="text-xl">{formatNaira(feed.sales_value)}</strong></div><div className="rounded-xl bg-emerald-50 p-4"><p className="text-sm text-emerald-900">Money received</p><strong className="text-xl text-emerald-950">{formatNaira(feed.received)}</strong></div></section>
      <section><h2 className="mb-3 text-lg font-semibold">History <span className="text-sm font-normal text-stone-600">({feed.count})</span></h2>{feed.items.length === 0 ? <p className="rounded-xl bg-white p-5 text-stone-600">No activity matches these filters. Try a wider date range.</p> : <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">{feed.items.map((item) => <li key={`${item.kind}-${item.id}`}><Link href={item.detail} className="flex min-h-20 items-center justify-between gap-3 p-4"><span><span className="block text-xs font-semibold uppercase tracking-wide text-emerald-800">{item.kind} · {formatBusinessDate(item.day)}</span><strong className="mt-1 block">{item.description}</strong>{item.sale_value > 0 && <small className="text-stone-600">Sale value {formatNaira(item.sale_value)}</small>}</span><span className="shrink-0 text-right font-semibold">{item.received > 0 ? formatNaira(item.received) : "→"}</span></Link></li>)}</ul>}</section>
      <nav aria-label="Activity pages" className="flex justify-between">{page > 1 ? <Link className="quiet-link" href={query(page-1)}>← Previous</Link> : <span />}{page*30 < feed.count && <Link className="quiet-link" href={query(page+1)}>Next →</Link>}</nav>
    </>}
  </div>;
}
