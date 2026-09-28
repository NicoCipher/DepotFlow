import Link from "next/link";
import { formatNaira } from "@/domain/products";
import {
  formatBusinessDate,
  salesHistoryState,
  type SaleSummary,
} from "@/domain/sales";

export function SalesList({
  sales,
  emptyTitle = "No sales yet",
  emptyMessage = "Saved sales will appear here.",
  showCustomer = true,
  showItemCount = true,
  showRecordSale = false,
}: {
  sales: SaleSummary[];
  emptyTitle?: string;
  emptyMessage?: string;
  showCustomer?: boolean;
  showItemCount?: boolean;
  showRecordSale?: boolean;
}) {
  const history = salesHistoryState(sales);
  if (history.empty)
    return (
      <div className="border-t border-stone-300 py-8">
        <h2 className="text-xl font-semibold">{emptyTitle}</h2>
        <p className="mt-2 text-stone-600">{emptyMessage}</p>
        {showRecordSale && (
          <Link className="primary mt-5" href="/record-sale">
            Record Sale
          </Link>
        )}
      </div>
    );
  return (
    <ul className="border-t border-stone-300">
      {history.sales.map((sale) => (
        <li key={sale.id} className="border-b border-stone-300">
          <Link
            href={`/sales/${sale.id}`}
            className="block min-h-24 py-4 focus-visible:rounded-sm"
          >
            <time
              dateTime={sale.businessDate ?? undefined}
              className="block text-sm text-stone-600"
            >
              {formatBusinessDate(sale.businessDate)}
            </time>
            {showCustomer && (
              <span className="mt-1 block break-words text-lg font-semibold">
                {sale.customerName}
              </span>
            )}
            {showItemCount && (
              <span className="mt-1 block text-sm text-stone-600">
                {sale.itemCount} {sale.itemCount === 1 ? "item" : "items"}
              </span>
            )}
            <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
              <span>Total {formatNaira(sale.total)}</span>
              <span>Paid {formatNaira(sale.paid)}</span>
            </span>
            <span
              className={`mt-1 block font-semibold ${sale.owing > 0 ? "text-red-800" : "text-emerald-800"}`}
            >
              {sale.owing > 0 ? `Still owing ${formatNaira(sale.owing)}` : "Paid in full"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
