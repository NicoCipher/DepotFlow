"use client";

import { useActionState } from "react";
import { registerDepot, type RegisterDepotState } from "@/app/businesses/new/actions";

const initial: RegisterDepotState = { name: "", address: "", phone: "", message: "" };

export function RegisterDepotForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(registerDepot, initial);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="request_id" value={requestId} />
      <div>
        <label htmlFor="new-depot-name" className="block font-semibold">
          Depot or business name
        </label>
        <p className="mb-2 text-xs text-stone-600">
          The exact name that will appear in your records and receipts.
        </p>
        <input id="new-depot-name" name="name" required minLength={2}
          maxLength={120} autoComplete="organization"
          defaultValue={state.name} placeholder="e.g. Walnik Ventures" />
      </div>
      <div>
        <label htmlFor="new-depot-address" className="block font-semibold">
          Shop location <span className="font-normal text-stone-500">(optional)</span>
        </label>
        <input id="new-depot-address" name="address" maxLength={400}
          autoComplete="street-address" defaultValue={state.address}
          placeholder="Street and area" />
        <p className="mt-1 text-xs text-stone-600">
          Use different locations to distinguish branches of the same business.
        </p>
      </div>
      <div>
        <label htmlFor="new-depot-phone" className="block font-semibold">
          Business phone <span className="font-normal text-stone-500">(optional)</span>
        </label>
        <input id="new-depot-phone" name="phone" type="tel" maxLength={40}
          autoComplete="tel" defaultValue={state.phone}
          placeholder="Phone number for receipts" />
      </div>
      {state.message && (
        <p role="alert" className="rounded-xl bg-stone-100 p-3 text-sm text-stone-900">
          {state.message}
        </p>
      )}
      <button type="submit" className="primary min-h-12 w-full" disabled={pending}>
        {pending ? "Saving your depot…" : "Create depot"}
      </button>
      <p className="text-xs leading-5 text-stone-600">
        This creates a separate business in setup only. It does not copy stock,
        customers, debts or sales from another depot, or enable live operations.
      </p>
    </form>
  );
}
