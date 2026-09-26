"use client";
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
    <form action={action} className="mt-6 space-y-5">
      <div>
        <label htmlFor="amount">Amount paid</label>
        <input
          id="amount"
          name="amount"
          inputMode="numeric"
          pattern="[0-9]+"
          required
          value={amount}
          readOnly={pending}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
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
          readOnly={pending}
          onChange={(event) => setBusinessDate(event.target.value)}
        />
      </div>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Record Payment"}
      </button>
    </form>
  );
}
