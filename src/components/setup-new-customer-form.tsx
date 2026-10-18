"use client";

import { useActionState } from "react";
import {
  addBusinessCustomer,
  type NewBusinessCustomerState,
} from "@/app/businesses/[businessId]/customers/actions";

const initial: NewBusinessCustomerState = { message: "", saved: false };

/** Owner-only customer record for opening setup. No payment/debt fields;
 * those are separate audited steps after the identity is created.
 */
export function SetupNewCustomerForm({
  businessId, customerId,
}: {
  businessId: string;
  customerId: string;
}) {
  const [state, action, pending] = useActionState(addBusinessCustomer, initial);
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="business_id" value={businessId} />
      <input type="hidden" name="customer_id" value={customerId} />
      <h2 className="text-base font-bold text-stone-950">Add an existing customer</h2>
      <p className="text-sm leading-6 text-stone-600">
        Just record who the customer is. Add any old debt, held deposit or
        unreturned empties separately, after saving their details.
      </p>
      <div>
        <label className="block text-sm font-semibold" htmlFor="setup-customer-name">
          Customer name
        </label>
        <input id="setup-customer-name" name="name" type="text" required
          maxLength={120} autoComplete="name" disabled={pending}
          placeholder="Customer's full name" className="mt-2 w-full" />
      </div>
      <div>
        <label className="block text-sm font-semibold" htmlFor="setup-customer-phone">
          Phone number
        </label>
        <input id="setup-customer-phone" name="phone" type="tel" required
          maxLength={40} autoComplete="tel" disabled={pending}
          placeholder="080..." className="mt-2 w-full" />
      </div>
      <details className="rounded-xl bg-stone-100 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">
          More details (optional)
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-sm font-semibold" htmlFor="setup-customer-business">
              Customer business name
            </label>
            <input id="setup-customer-business" name="business_name"
              maxLength={160} disabled={pending} className="mt-1 w-full" />
          </div>
          <div>
            <label className="block text-sm font-semibold" htmlFor="setup-customer-address">
              Address
            </label>
            <textarea id="setup-customer-address" name="address"
              rows={2} maxLength={500} disabled={pending}
              className="mt-1 w-full" />
          </div>
        </div>
      </details>
      {state.message && (
        <p className="rounded-xl bg-stone-100 p-3 text-sm" role="alert">
          {state.message}
        </p>
      )}
      <button className="primary min-h-12 w-full" type="submit" disabled={pending}>
        {pending ? "Saving customer…" : "Save customer"}
      </button>
    </form>
  );
}
