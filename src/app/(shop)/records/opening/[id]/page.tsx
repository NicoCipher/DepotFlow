import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";

type StoredLine = { type: string; name: string; quantity: number };

export default async function OpeningRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    notFound();
  const db = await requireOwner();
  const { data: opening, error } = await db
    .from("customer_opening_balances")
    .select("id,customer_id,business_date,amount,crates,bottles,note")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load the saved opening record.");
  if (!opening) notFound();
  const { data: customer, error: customerError } = await db
    .from("customers")
    .select("name,business_name")
    .eq("id", opening.customer_id)
    .single();
  if (customerError || !customer) throw new Error("Could not load this customer.");
  const crates = opening.crates as StoredLine[];
  const bottles = opening.bottles as StoredLine[];
  const crateCount = crates.reduce((n, row) => n + row.quantity, 0);
  const bottleCount = bottles.reduce((n, row) => n + row.quantity, 0);

  return (
    <div className="space-y-5 pb-10">
      <Link href="/records" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800">
        <span aria-hidden="true">←</span> Records
      </Link>
      <header className="rounded-3xl bg-emerald-950 p-5 text-white shadow-[0_12px_35px_rgba(6,78,59,.14)] sm:p-7">
        <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-bold">Opening balances · Saved record</span>
        <h1 className="mt-5 text-2xl font-extrabold text-white sm:text-3xl">Balance brought forward</h1>
        <p className="mt-2 break-words text-lg font-semibold text-emerald-50">{customer.name}</p>
        {customer.business_name && <p className="text-sm text-emerald-100">{customer.business_name}</p>}
        <p className="mt-1 text-xs text-emerald-100">{formatBusinessDate(opening.business_date)}</p>
        <div className="mt-5 border-t border-white/20 pt-5">
          <p className="text-xs font-medium text-emerald-100">Money owed before using DepotFlow</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">{formatNaira(opening.amount)}</p>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-3" aria-label="Physical empties brought forward">
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-600">Crates owed before</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-stone-950">{crateCount}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-600">Bottles owed before</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-stone-950">{bottleCount}</p>
        </div>
      </section>
      {(crates.length > 0 || bottles.length > 0) && (
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <h2 className="bg-stone-50 px-5 py-4 text-lg font-bold">Original empties owed</h2>
          <dl className="divide-y divide-stone-100 px-5">
            {[...crates.map(row => ({ ...row, unit: "crate" })), ...bottles.map(row => ({...row,unit:"bottle"}))].map((row, index) => (
              <div key={index} className="flex items-center justify-between gap-4 py-4">
                <dt className="min-w-0 break-words text-sm font-medium text-stone-800">{row.name} · {row.unit}{row.quantity === 1 ? "" : "s"}</dt>
                <dd className="text-base font-extrabold tabular-nums text-stone-950">{row.quantity}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {opening.note && <p className="rounded-xl bg-stone-100 p-4 text-sm leading-6 text-stone-700"><span className="font-bold">Saved note:</span> {opening.note}</p>}
      <p className="text-sm leading-6 text-stone-600">These are the original starting balances, not what the customer owes today. No payment was received by recording them.</p>
      <Link href={`/customers/${opening.customer_id}`} className="primary flex min-h-13 w-full items-center justify-between px-5">
        Check current customer balances <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
