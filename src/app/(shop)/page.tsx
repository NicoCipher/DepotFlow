import Link from "next/link";
import { PausedSalesLink } from "@/components/paused-sales-link";
import { formatNaira } from "@/domain/products";
import { requireOwnerSession } from "@/lib/auth/owner";

function todayLagos() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export default async function Home() {
  const { user, supabase } = await requireOwnerSession();
  const day = todayLagos();
  const { data, error } = await supabase.rpc("manager_snapshot", { p_day: day });
  if (error) throw new Error("Could not load today’s shop snapshot.");
  const snapshot = data as { sales_count: number; sales_value: number; received: number; outstanding: number; customers_owing: number; low_stock: number; missing_counts: number };
  return <div className="space-y-7">
    <header><p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Manager snapshot · {day}</p><h1>Home</h1><p className="mt-1 text-stone-600">Today’s sales, cash and what needs attention.</p></header>
    <Link href="/record-sale" className="flex min-h-20 items-center justify-between rounded-2xl bg-emerald-900 px-5 text-xl font-semibold text-white shadow-sm">Record Sale <span aria-hidden="true">→</span></Link>
    <PausedSalesLink ownerId={user.id} />
    <section aria-labelledby="today-heading"><h2 id="today-heading" className="mb-3 text-lg font-semibold">Today</h2><div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-stone-200 bg-white p-4"><p className="text-sm text-stone-600">Sales value</p><p className="mt-1 text-2xl font-bold">{formatNaira(snapshot.sales_value)}</p><p className="mt-1 text-xs text-stone-500">{snapshot.sales_count} sales · includes credit</p></div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm text-emerald-900">Money received</p><p className="mt-1 text-2xl font-bold text-emerald-950">{formatNaira(snapshot.received)}</p><p className="mt-1 text-xs text-emerald-800">Sale payments + collections</p></div>
    </div></section>
    <section aria-labelledby="attention-heading"><h2 id="attention-heading" className="mb-3 text-lg font-semibold">Needs attention</h2><div className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white px-4">
      <Link href="/customers" className="flex min-h-16 items-center justify-between gap-3 py-3"><span><strong className="block">Outstanding balances</strong><small className="text-stone-600">{snapshot.customers_owing} customers owe money</small></span><strong className="shrink-0 text-emerald-950">{formatNaira(snapshot.outstanding)} →</strong></Link>
      <Link href="/stock" className="flex min-h-16 items-center justify-between gap-3 py-3"><span><strong className="block">Low stock</strong><small className="text-stone-600">One crate or less</small></span><strong>{snapshot.low_stock} drinks →</strong></Link>
      {snapshot.missing_counts > 0 && <Link href="/stock/count" className="flex min-h-16 items-center justify-between gap-3 py-3"><span><strong className="block">Stock not counted</strong><small className="text-stone-600">Record starting quantities</small></span><strong>{snapshot.missing_counts} →</strong></Link>}
    </div></section>
    <Link href="/activity" className="secondary w-full">View all store activity →</Link>
  </div>;
}
