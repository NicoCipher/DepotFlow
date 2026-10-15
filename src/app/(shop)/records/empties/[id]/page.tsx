import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { formatBusinessDate } from "@/domain/sales";

type ReturnLine = { name: string; quantity: number; owed_name?: string | null };
type ReleasedLine = ReturnLine & { kind: "crate" | "bottle" };
type ReturnRecord = {
  id: string; customer_id: string; customer_name: string;
  business_name: string | null; created_at: string;
  crates: ReturnLine[]; bottles: ReturnLine[]; released: ReleasedLine[];
};

function ReturnSection({
  label, description, entries, tone = "normal",
}: {
  label: string;
  description: string;
  entries: { name: string; quantity: number; unit: string; owed_name?: string | null }[];
  tone?: "normal" | "caution";
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className={`px-5 py-4 sm:px-6 ${tone === "caution" ? "bg-amber-50" : "bg-stone-50/70"}`}>
        <h2 className="text-lg font-bold text-stone-950">{label}</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
      </div>
      <dl className="divide-y divide-stone-100 px-5 sm:px-6">
        {entries.map((row, index) => (
          <div key={index} className="flex items-center justify-between gap-4 py-4">
            <dt className="min-w-0 break-words text-sm font-medium text-stone-800">
              {row.name} <span className="text-stone-500">· {row.unit}</span>
              {row.owed_name && <span className="mt-1 block text-xs font-normal text-stone-600">
                Accepted instead of {row.owed_name} to settle this customer&apos;s crate debt
              </span>}
            </dt>
            <dd className="shrink-0 rounded-lg bg-stone-100 px-3 py-1 text-base font-extrabold tabular-nums text-stone-950">
              {row.quantity}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function EmptiesRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await requireOwner();
  const { data, error } = await db.rpc("customer_return_record", { p_id: id });
  if (error) throw new Error("Could not load the saved empties return.");
  const saved = data as ReturnRecord | null;
  if (!saved) notFound();

  const crates = saved.crates.reduce((sum, row) => sum + row.quantity, 0);
  const bottles = saved.bottles.reduce((sum, row) => sum + row.quantity, 0);
  const heldCrates = saved.released.filter(row => row.kind === "crate").reduce((sum, row) => sum + row.quantity, 0);
  const heldBottles = saved.released.filter(row => row.kind === "bottle").reduce((sum, row) => sum + row.quantity, 0);
  const hasReturns = crates > 0 || bottles > 0;
  const hasCollections = heldCrates > 0 || heldBottles > 0;
  const heldOnly = !hasReturns && hasCollections;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(saved.created_at));
  const time = new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit",
  }).format(new Date(saved.created_at));
  const returns = [
    ...saved.crates.map(row => ({ ...row, unit: row.quantity === 1 ? "crate" : "crates" })),
    ...saved.bottles.map(row => ({ ...row, unit: row.quantity === 1 ? "bottle" : "bottles" })),
  ];
  return (
    <div className="space-y-5 pb-10">
      <nav aria-label="Record details">
        <Link href="/records" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800">
          <span aria-hidden="true">←</span> Back to Records
        </Link>
      </nav>
      <header className="overflow-hidden rounded-3xl bg-emerald-950 p-5 text-white shadow-[0_12px_35px_rgba(6,78,59,.14)] sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
            {heldOnly ? "Held empties collected" : hasCollections ? "Returns and collections" : "Empties returned"}
          </span>
          <span className="text-xs text-emerald-100">{formatBusinessDate(date)} · {time}</span>
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          {heldOnly ? "Customer collected held empties" : hasCollections ? "Empties recorded" : "Return recorded"}
        </h1>
        <p className="mt-2 break-words text-lg font-semibold text-emerald-50">{saved.customer_name}</p>
        {saved.business_name && saved.business_name !== saved.customer_name &&
          <p className="mt-1 text-sm text-emerald-100">{saved.business_name}</p>}
        {hasReturns && (
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/20 pt-5" aria-label="Empties returned to shop">
            <div>
              <p className="text-xs text-emerald-100">Crates returned</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">{crates}</p>
            </div>
            <div>
              <p className="text-xs text-emerald-100">Bottles returned</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">{bottles}</p>
            </div>
          </div>
        )}
        {hasCollections && (
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/20 pt-5" aria-label="Held empties collected by customer">
            <div>
              <p className="text-xs text-emerald-100">Held crates collected</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">{heldCrates}</p>
            </div>
            <div>
              <p className="text-xs text-emerald-100">Held bottles collected</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">{heldBottles}</p>
            </div>
          </div>
        )}
      </header>
      <Link href={`/customers/${saved.customer_id}`}
        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-950 transition hover:bg-emerald-100">
        View customer account <span aria-hidden="true">→</span>
      </Link>
      {returns.length > 0 && (
        <ReturnSection label="Empties returned" description="These are the actual branded crates and bottles received. Approved replacements identify the original crate debt they settled."
          entries={returns}/>
      )}
      {saved.released.length > 0 && (
        <ReturnSection label="Held empties given back" tone="caution"
          description={`Customer collected ${heldCrates} held crates and ${heldBottles} held bottles. These were not added to usable empty stock.`}
          entries={saved.released.map(row => ({
            name: row.name, quantity: row.quantity, unit: row.kind === "crate"
              ? (row.quantity === 1 ? "crate" : "crates")
              : (row.quantity === 1 ? "bottle" : "bottles"),
          }))}/>
      )}
      <div className="rounded-2xl bg-stone-100 p-4 text-sm leading-6 text-stone-700">
        <span className="font-bold">No money recorded.</span> This is an empties record, not a payment receipt.
      </div>
      <details className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-xs text-stone-600">
        <summary className="min-h-8 cursor-pointer py-1 font-semibold text-stone-700">Record reference</summary>
        <p className="mt-2 break-all font-mono">{saved.id}</p>
      </details>
    </div>
  );
}
