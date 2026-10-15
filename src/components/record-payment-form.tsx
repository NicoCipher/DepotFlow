"use client";
import { SessionRecoveryLink } from "./session-recovery-link";
import { useActionState, useState } from "react";
import { recordPayment } from "@/app/(shop)/customers/[id]/pay/actions";
import { formatNaira } from "@/domain/products";
import { paymentConfirmationKey } from "@/domain/action-confirmations";

export function RecordPaymentForm({
  customerId,
  requestId,
  owed,
}: {
  customerId: string;
  requestId: string;
  owed: number;
}) {
  // Keep the request ID stable across re-renders so a retry is safe.
  const [submissionId] = useState(requestId);
  const [method, setMethod] = useState("");
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [businessDate, setBusinessDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE"),
  );
  const [state, action, pending] = useActionState(
    recordPayment.bind(null, customerId, submissionId),
    { amount: "", businessDate: "", method: "" },
  );
  const validAmount = /^\d+$/.test(amount) && Number(amount) > 0;
  const numericAmount = validAmount ? Number(amount) : 0;
  const exceedsBalance = validAmount && numericAmount > owed;
  const remaining = validAmount && !exceedsBalance ? owed - numericAmount : null;
  const reviewKey = paymentConfirmationKey({ request: submissionId, customer: customerId, amount, method, businessDate, owed });
  const confirmed = confirmedKey === reviewKey;
  return (
    <form action={action} className="mt-5 space-y-5" onSubmit={(event) => {
      if (pending || !validAmount || exceedsBalance || !method || !businessDate) {
        event.preventDefault();
        return;
      }
      if (!confirmed) {
        event.preventDefault();
        setConfirmedKey(reviewKey);
      }
    }}>
      <button
        type="button"
        className="secondary w-full"
        aria-pressed={amount === String(owed)}
        disabled={pending || state.retryable}
        onClick={() => setAmount(String(owed))}
      >
        Pay full balance · {formatNaira(owed)}
      </button>
      <div>
        <label htmlFor="amount">Amount paid now (₦)</label>
        <input
          id="amount"
          name="amount"
          inputMode="numeric"
          pattern="[0-9]+"
          required
          value={amount}
          readOnly={pending || state.retryable}
          aria-invalid={state.field === "amount" || exceedsBalance}
          aria-describedby={state.field === "amount" || exceedsBalance ? "payment-amount-error" : undefined}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      {(state.field === "amount" || exceedsBalance) && <p id="payment-amount-error" role="alert" className="text-sm text-red-800">{exceedsBalance ? `This customer owes ${formatNaira(owed)}. Enter that amount or less.` : state.message}</p>}
      {remaining !== null && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span className="text-stone-600">Paying now</span>
            <strong>{formatNaira(numericAmount)}</strong>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-stone-200 pt-2">
            <span className="font-medium">Still owing after</span>
            <strong className={remaining > 0 ? "text-amber-900" : "text-emerald-900"}>
              {formatNaira(remaining)}
            </strong>
          </div>
        </div>
      )}
      <div>
        <label htmlFor="businessDate">Business date</label>
        <input
          id="businessDate"
          name="businessDate"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          required
          value={businessDate}
          readOnly={pending || state.retryable}
          aria-invalid={state.field === "businessDate"}
          aria-describedby={state.field === "businessDate" ? "payment-date-error" : undefined}
          onChange={(event) => setBusinessDate(event.target.value)}
        />
      </div>
      {state.field === "businessDate" && <p id="payment-date-error" role="alert" className="text-red-800">{state.message}</p>}
      <div>
        <label htmlFor="method">Payment method</label>
        <select id="method" name="method" required value={method}
          aria-invalid={state.field === "method"} aria-describedby={state.field === "method" ? "payment-method-error" : undefined}
          onChange={(event) => { if (!pending && !state.retryable) setMethod(event.target.value); }}>
          <option value="">Choose method</option>
          <option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option>
        </select>
        {state.field === "method" && <p id="payment-method-error" role="alert" className="mt-2 text-sm text-red-800">{state.message}</p>}
      </div>
      {state.message && !state.field && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <SessionRecoveryLink message={state.message} />
      {!pending && confirmed && (
        <section aria-label="Confirm customer payment" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="font-bold text-emerald-950">Confirm this payment</h2>
          <p className="mt-1 text-sm text-emerald-950">
            Record {formatNaira(numericAmount)} toward previous money owed
            using {method === "transfer" ? "bank transfer" : method === "pos" ? "POS" : "cash"} on {businessDate}?
          </p>
          <p className="mt-1 text-sm text-stone-700">Customer will still owe {remaining === null ? "—" : formatNaira(remaining)}. This creates a permanent payment record.</p>
          <button type="button" className="secondary mt-3 min-h-11 w-full" onClick={() => setConfirmedKey(null)}>Go back and edit</button>
        </section>
      )}
      <button className="primary w-full" disabled={pending || exceedsBalance || !validAmount || !method || !businessDate}>
        {pending
          ? "Saving…"
          : state.retryable
            ? "Retry same payment"
            : confirmed
              ? `Yes, save ${formatNaira(numericAmount)} payment`
              : "Review payment before saving"}
      </button>
    </form>
  );
}
