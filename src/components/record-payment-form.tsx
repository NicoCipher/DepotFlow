"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { recordPayment } from "@/app/(shop)/customers/[id]/pay/actions";

export function RecordPaymentForm({
  customerId,
  requestId,
}: {
  customerId: string;
  requestId: string;
}) {
  // Keep the request ID stable across re-renders so a retry is safe.
  const [submissionId] = useState(requestId);
  const [amount, setAmount] = useState("");
  const [businessDate, setBusinessDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE"),
  );
  const [state, action, pending] = useActionState(
    recordPayment.bind(null, customerId, submissionId),
    { amount: "", businessDate: "" },
  );
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
          aria-invalid={state.field === "amount"}
          aria-describedby={state.field === "amount" ? "payment-amount-error" : undefined}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      {state.field === "amount" && <p id="payment-amount-error" role="alert" className="text-red-800">{state.message}</p>}
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
      {state.message && !state.field && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      {state.message?.startsWith("Your session has expired") && (
        <Link href="/sign-in" target="_blank" rel="noopener noreferrer" className="quiet-link">Sign in in a new tab</Link>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : state.retryable ? "Retry same payment" : "Save payment"}
      </button>
    </form>
  );
}
