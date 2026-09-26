import Link from "next/link";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { getSale } from "@/lib/sales/data";

export default async function SalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sale = await getSale(id);
  return (
    <>
      <Link className="quiet-link -mt-3 mb-3 self-start" href="/sales">
        Back to Sales
      </Link>
      <h1>Sale details</h1>
      <p className="mt-4 break-words text-xl font-semibold">
        {sale.customerName}
      </p>
      <time
        dateTime={sale.businessDate ?? undefined}
        className="mt-1 block text-lg text-stone-700"
      >
        {formatBusinessDate(sale.businessDate)}
      </time>
      <dl className="mt-6 border-t border-stone-300">
        {[
          ["Grand total", formatNaira(sale.total)],
          ["Amount paid", formatNaira(sale.paid)],
          ["Owing from this sale", formatNaira(sale.owing)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-stone-300 py-4"
          >
            <dt>{label}</dt>
            <dd
              className={`text-xl font-semibold ${label === "Owing from this sale" && sale.owing > 0 ? "text-red-800" : ""}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <section className="mt-9" aria-labelledby="sale-items-heading">
        <h2 id="sale-items-heading" className="text-2xl font-semibold">
          Drinks
        </h2>
        <ul className="mt-3 border-t border-stone-300">
          {sale.items.map((item) => (
            <li key={item.id} className="border-b border-stone-300 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="break-words text-lg font-semibold">
                    {item.productName}
                  </h3>
                  <p className="mt-1 text-stone-700">{item.quantity}</p>
                </div>
                <p className="shrink-0 font-semibold">
                  {formatNaira(item.lineTotal)}
                </p>
              </div>
              {(item.cratesReturned > 0 || item.cratesOwed > 0) && (
                <div className="mt-4 border-l-2 border-stone-300 pl-3 text-sm">
                  <p className="font-medium">
                    Crates{item.crateType ? ` · ${item.crateType}` : ""}
                  </p>
                  <p className="mt-1 text-stone-700">
                    Returned {item.cratesReturned} · Owed {item.cratesOwed}
                  </p>
                </div>
              )}
              {item.bottlesReturnable && (
                <div className="mt-3 border-l-2 border-stone-300 pl-3 text-sm">
                  <p className="font-medium">
                    Bottles{item.bottleType ? ` · ${item.bottleType}` : ""}
                  </p>
                  <p className="mt-1 text-stone-700">
                    Returned {item.bottlesReturned} · Owed {item.bottlesOwed}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <dl className="mt-8 border-t border-stone-300 py-5 text-sm">
        <dt className="font-semibold">Sale reference</dt>
        <dd className="mt-1 break-all text-stone-700">{sale.id}</dd>
      </dl>
      <Link className="secondary w-full" href={`/customers/${sale.customerId}`}>
        View Customer
      </Link>
    </>
  );
}
