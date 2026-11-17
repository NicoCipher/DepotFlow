"use client";

import { useActionState, useState } from "react";
import {
  recordBusinessCustomerPayment,
  type CustomerPaymentState,
} from "./actions";

const initial: CustomerPaymentState = { message: "", saved: false };

export function BusinessCustomerPaymentForm({
  businessId, customerId, customerName, requestId, businessDate, outstanding,
}: {
  businessId: string;
  customerId: string;
  customerName: string;
  requestId: string;
  businessDate: string;
  outstanding: number;
}) {
  const [stableRequestId] = useState(requestId);
  const [state, action, pending] = useActionState(recordBusinessCustomerPayment, initial);

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-stone-200 p-4">
      <input type="hidden" name="business_id" value={businessId} />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="request_id" value={stableRequestId} />
      <input type="hidden" name="business_date" value={businessDate} />
      <div>
        <h2 className="text-lg font-bold">Record a debt payment</h2>
        <p className="mt-1 text-sm text-stone-600">
          This reduces {customerName}&apos;s existing money debt. It does not change sales, deposits or empty-container balances.
        </p>
      </div>
      <label className="block text-sm font-semibold" htmlFor="tenant-customer-payment-amount">
        Amount received (₦)
        <input id="tenant-customer-payment-amount" name="amount" type="number"
          inputMode="numeric" min={1} max={outstanding} step={1} required
          disabled={pending || state.saved} className="mt-2 w-full" />
      </label>
      <p className="text-xs text-stone-600">
        Maximum: ₦{outstanding.toLocaleString("en-NG")}. The database rejects payments above the current balance.
      </p>
      <label className="block text-sm font-semibold" htmlFor="tenant-customer-payment-method">
        Payment method
        <select id="tenant-customer-payment-method" name="method" required
          disabled={pending || state.saved} defaultValue="cash" className="mt-2 w-full">
          <option value="cash">Cash</option>
          <option value="transfer">Bank transfer</option>
          <option value="pos">POS</option>
        </select>
      </label>
      {state.message && (
        <div role={state.saved ? "status" : "alert"} className="rounded-xl bg-stone-100 p-3 text-sm">
          <p className="font-semibold">{state.message}</p>
          {state.saved && (
            <>
              <p className="mt-2">Receipt: <strong>{state.receiptNumber}</strong></p>
              <p>Remaining debt: <strong>₦{state.owing?.toLocaleString("en-NG")}</strong></p>
              <p className="mt-2 text-xs text-stone-600">Reload this page to verify the latest balance before recording another payment.</p>
            </>
          )}
        </div>
      )}
      {!state.saved && (
        <button type="submit" disabled={pending} className="primary min-h-12 w-full disabled:opacity-50">
          {pending ? "Recording payment…" : "Confirm payment"}
        </button>
      )}
    </form>
  );
}
