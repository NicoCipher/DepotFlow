import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { formatBusinessDate } from "@/domain/sales";

type ReturnLine = { name: string; quantity: number };
type ReleasedLine = ReturnLine & { kind: "crate" | "bottle" };
type ReturnRecord = {
  id: string; customer_id: string; customer_name: string;
  business_name: string | null; created_at: string;
  crates: ReturnLine[]; bottles: ReturnLine[]; released: ReleasedLine[];
};

export default async function EmptiesRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await requireOwner();
  const { data, error } = await db.rpc("customer_return_record", { p_id: id });
  if (error) throw new Error("Could not load the saved empties return.");
  const saved = data as ReturnRecord | null;
  if (!saved) notFound();
  const lines = [
    ...saved.crates.map(row => ({ ...row, unit: "crates" })),
    ...saved.bottles.map(row => ({ ...row, unit: "bottles" })),
  ];
  const time = new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit",
  }).format(new Date(saved.created_at));
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(saved.created_at));
  return (
    <div className="space-y-6 pb-10">
      <Link href="/records" className="quiet-link inline-flex min-h-11 items-center text-sm">← All records</Link>
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">Saved customer record</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Empties returned</h1>
        <p className="mt-2 text-stone-600">{formatBusinessDate(date)} · {time}</p>
      </header>
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Customer</p>
        <h2 className="mt-2 break-words text-xl font-bold">{saved.customer_name}</h2>
        {saved.business_name && <p className="mt-1 text-sm text-stone-600">{saved.business_name}</p>}
        <Link href={`/customers/${saved.customer_id}`} className="quiet-link mt-3 inline-flex min-h-11 items-center">View customer account →</Link>
      </section>
      {lines.length > 0 && <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">Correct empties brought back</h2>
        <p className="mt-1 text-sm text-stone-600">These returns reduced what the customer owed.</p>
        <dl className="mt-4 divide-y divide-stone-100">
          {lines.map((row, index) => <div key={index} className="flex items-center justify-between gap-3 py-3">
            <dt className="break-words text-stone-700">{row.name} · {row.unit}</dt>
            <dd className="shrink-0 text-lg font-bold tabular-nums">{row.quantity}</dd>
          </div>)}
        </dl>
      </section>}
      {saved.released.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-xl font-semibold text-amber-950">Wrong empties collected by customer</h2>
        <p className="mt-1 text-sm leading-6 text-amber-950">These were held for the customer and handed back. They were not added to usable empty stock.</p>
        <dl className="mt-4 divide-y divide-amber-200">
          {saved.released.map((row, index) => <div key={index} className="flex items-center justify-between gap-3 py-3">
            <dt className="break-words text-amber-950">{row.name} · {row.kind === "crate" ? "crates" : "bottles"}</dt>
            <dd className="shrink-0 text-lg font-bold tabular-nums text-amber-950">{row.quantity}</dd>
          </div>)}
        </dl>
      </section>}
      <p className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
        Empties record only. No cash payment was created by this return.
      </p>
      <p className="break-all text-xs text-stone-500">Saved reference: {saved.id}</p>
    </div>
  );
}
