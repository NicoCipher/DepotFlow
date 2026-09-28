"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { recordPayment } from "@/app/(shop)/customers/[id]/pay/actions";

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
  const [amount, setAmount] = useState("");
  const [businessDate, setBusinessDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE"),
  );
  const [state, action, pending] = useActionState(
    recordPayment.bind(null, customerId, submissionId),
    { amount: "", businessDate: "", method: "" },
  );
  const exceedsBalance = /^\d+$/.test(amount) && Number(amount) > owed;
  return (
    <form action={action} className="mt-5 space-y-5">
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
      {(state.field === "amount" || exceedsBalance) && <p id="payment-amount-error" role="alert" className="text-sm text-red-800">{exceedsBalance ? `This customer owes ₦${owed.toLocaleString("en-NG")}. Enter that amount or less.` : state.message}</p>}
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
      {state.message?.startsWith("Your session has expired") && (
        <Link href="/sign-in" target="_blank" rel="noopener noreferrer" className="quiet-link">Sign in in a new tab</Link>
      )}
      <button className="primary w-full" disabled={pending || exceedsBalance}>
        {pending ? "Saving…" : state.retryable ? "Retry same payment" : "Save payment"}
      </button>
    </form>
  );
}
