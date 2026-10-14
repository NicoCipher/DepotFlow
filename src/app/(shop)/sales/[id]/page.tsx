import Link from "next/link";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { getSale } from "@/lib/sales/data";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sale = await getSale(id);
  const unpaid = sale.owing > 0;
  const voided = sale.receiptStatus === "voided";

  return (
    <div className="space-y-5 pb-9">
      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Sale navigation">
        <Link href="/records" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800">
          <span aria-hidden="true">←</span> Records
        </Link>
        <Link href="/sales" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline underline-offset-4">All sales →</Link>
      </nav>

      <header className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-[0_5px_24px_rgba(15,46,30,.04)]">
        <div className="border-b border-stone-100 bg-stone-50/80 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-[.12em] text-emerald-800">Saved sale</span>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${voided ? "bg-red-100 text-red-900" : unpaid ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
              {voided ? "Voided" : unpaid ? sale.paid > 0 ? "Partly paid" : "Not paid yet" : "Paid in full"}
            </span>
          </div>
          <h1 className="mt-3 break-words text-2xl font-extrabold text-stone-950 sm:text-3xl">{sale.customerName}</h1>
          <p className="mt-1 text-sm text-stone-600">{formatBusinessDate(sale.businessDate)}</p>
        </div>
        <div className="px-5 py-5 sm:px-6">
          {voided && <p role="status" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold leading-6 text-red-950">Voided sale. The figures below are saved history, not proof of a valid payment.</p>}
          <p className="text-xs font-bold uppercase tracking-wider text-stone-500">Sale value</p>
          <strong className="mt-1 block text-3xl font-extrabold tabular-nums tracking-tight text-stone-950 sm:text-4xl">
            {formatNaira(sale.total)}
          </strong>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-50 px-4 py-4">
              <p className="text-xs font-semibold text-emerald-900">Received on sale</p>
              <p className="mt-1 break-words text-xl font-extrabold tabular-nums text-emerald-950">{formatNaira(sale.paid)}</p>
            </div>
            <div className={`rounded-xl px-4 py-4 ${unpaid ? "bg-amber-50" : "bg-stone-100"}`}>
              <p className={`text-xs font-semibold ${unpaid ? "text-amber-900" : "text-stone-700"}`}>Still owing on sale</p>
              <p className={`mt-1 break-words text-xl font-extrabold tabular-nums ${unpaid ? "text-amber-950" : "text-stone-900"}`}>{formatNaira(sale.owing)}</p>
            </div>
          </div>
          <Link href={`/receipts/sale/${sale.id}`}
            className="primary mt-5 flex min-h-13 w-full items-center justify-center gap-2 text-base">
            View & share receipt <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white" aria-labelledby="sale-drinks-title">
        <div className="flex flex-wrap items-end justify-between gap-3 bg-stone-50/80 px-5 py-4 sm:px-6">
          <div>
            <h2 id="sale-drinks-title" className="text-lg font-extrabold">Drinks sold</h2>
            <p className="mt-1 text-xs text-stone-600">Quantities and amounts saved on this sale</p>
          </div>
          <span className="rounded-full bg-stone-200 px-3 py-1 text-xs font-bold text-stone-700">{sale.items.length} {sale.items.length === 1 ? "item" : "items"}</span>
        </div>
        <ul className="divide-y divide-stone-100 px-5 sm:px-6">
          {sale.items.map((item) => (
            <li key={item.id} className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="break-words font-bold text-stone-950">{item.productName}</h3>
                  <p className="mt-1 text-sm text-stone-600">{item.quantity}</p>
                </div>
                <p className="shrink-0 text-base font-extrabold tabular-nums text-stone-950">{formatNaira(item.lineTotal)}</p>
              </div>
              {(item.cratesReturned > 0 || item.cratesOwed > 0 || item.bottlesReturnable) && (
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  {(item.cratesReturned > 0 || item.cratesOwed > 0) && (
                    <p className="rounded-lg bg-stone-50 px-3 py-2 leading-5 text-stone-700">
                      <span className="font-bold">Crates{item.crateType ? ` · ${item.crateType}` : ""}</span><br/>
                      Returned {item.cratesReturned} · Owed {item.cratesOwed}
                    </p>
                  )}
                  {item.bottlesReturnable && (
                    <p className="rounded-lg bg-stone-50 px-3 py-2 leading-5 text-stone-700">
                      <span className="font-bold">Bottles{item.bottleType ? ` · ${item.bottleType}` : ""}</span><br/>
                      Returned {item.bottlesReturned} · Owed {item.bottlesOwed}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {sale.emptyChoices.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-white">
          <div className="rounded-t-2xl bg-amber-50 px-5 py-4">
            <h2 className="text-lg font-extrabold text-amber-950">Different empties from this sale</h2>
            <p className="mt-1 text-xs leading-5 text-amber-900">What was accepted or held when this sale was saved</p>
          </div>
          <ul className="divide-y divide-stone-100 px-5">
            {sale.emptyChoices.map(choice => (
              <li key={choice.id} className="py-4 text-sm">
                <p className="font-bold text-stone-900">
                  {choice.product_name} · {choice.quantity} {choice.returned_name} {choice.kind === "crate" ? "crates" : "bottles"}
                </p>
                <p className="mt-1 leading-6 text-stone-700">
                  {choice.decision === "accept"
                    ? `Accepted instead of ${choice.owed_name}.`
                    : choice.released_at
                      ? `Customer collected held empties. ${choice.owed_name} was still owed when saved.`
                      : `Held for customer. ${choice.owed_name} was still owed when saved.`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href={`/customers/${sale.customerId}`}
        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-950">
        View customer account and current balances <span aria-hidden="true">→</span>
      </Link>
      <details className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-xs text-stone-600">
        <summary className="min-h-8 cursor-pointer py-1 font-semibold text-stone-700">Sale reference</summary>
        <p className="mt-2 break-all font-mono">{sale.id}</p>
      </details>
    </div>
  );
}
