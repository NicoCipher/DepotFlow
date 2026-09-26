import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { paymentHistoryState, type PaymentSummary } from "@/domain/payments";

export function PaymentsList({ payments }: { payments: PaymentSummary[] }) {
  const history = paymentHistoryState(payments);
  if (history.empty)
    return (
      <div className="border-t border-stone-300 py-8">
        <h3 className="text-lg font-semibold">No payments yet</h3>
        <p className="mt-2 text-stone-600">
          Recorded payments will appear here.
        </p>
      </div>
    );
  return (
    <ul className="border-t border-stone-300">
      {history.payments.map((payment) => (
        <li
          key={payment.id}
          className="flex items-center justify-between gap-3 border-b border-stone-300 py-5"
        >
          <div>
            <time
              dateTime={payment.businessDate}
              className="block text-lg font-semibold"
            >
              {formatBusinessDate(payment.businessDate)}
            </time>
            <span className="mt-1 block text-sm text-stone-600">
              Money owed after: {formatNaira(payment.owedAfter)}
            </span>
          </div>
          <span className="shrink-0 text-xl font-semibold text-emerald-800">
            {formatNaira(payment.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
