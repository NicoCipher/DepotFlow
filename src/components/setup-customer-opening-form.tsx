"use client";

import { useActionState, useState } from "react";
import {
  saveCustomerOpening, type CustomerOpeningState,
} from "@/app/businesses/[businessId]/customers/[customerId]/opening/actions";

type Item = { type: string; name: string };
type Entry = { type: string; quantity: string };
const initial: CustomerOpeningState = { message: "" };

function OwedTypes({
  label, options, entries, onChange,
}: {
  label: string;
  options: Item[];
  entries: Entry[];
  onChange: (next: Entry[]) => void;
}) {
  const unused = options.filter((o) =>
    !entries.some((row) => row.type === o.type));
  const key = label === "Empty crates" ? "crate" : "bottle";
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{label}</h4>
      {entries.map((row, i) => (
        <div className="flex flex-wrap items-center gap-2" key={i}>
          <label className="sr-only" htmlFor={`owed-${key}-type-${i}`}>
            Choose {label.toLowerCase()} type
          </label>
          <select id={`owed-${key}-type-${i}`} required
            value={row.type} className="min-w-36 flex-1"
            onChange={(e) => onChange(entries.map((item, j) =>
              j === i ? { ...item, type: e.target.value } : item))}>
            <option value="">Choose exact type</option>
            {options.filter((o) => o.type === row.type ||
              !entries.some((other, j) => j !== i && other.type === o.type))
              .map((item) => (
                <option key={item.type} value={item.type}>{item.name}</option>
              ))}
          </select>
          <label className="sr-only" htmlFor={`owed-${key}-quantity-${i}`}>
            Quantity owed
          </label>
          <input id={`owed-${key}-quantity-${i}`} type="number"
            inputMode="numeric" min={1} step={1} required
            className="w-20 shrink-0"
            value={row.quantity}
            onChange={(e) => onChange(entries.map((current, j) =>
              j === i ? { ...current, quantity: e.target.value } : current))} />
          <button type="button" className="secondary min-h-10 px-2 text-xs"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
            aria-label={`Remove ${label.toLowerCase()} entry`}>Remove</button>
        </div>
      ))}
      <button type="button" className="quiet-link min-h-11 text-sm"
        disabled={!unused.length}
        onClick={() => onChange([...entries, { type: "", quantity: "1" }])}>
        {unused.length ? `+ Add ${label.toLowerCase()}` : "All types selected"}
      </button>
    </div>
  );
}

/** Financial opening entries are not today’s transactions. They are
 * historical numbers and customer container obligations recorded once.
 */
export function SetupCustomerOpeningForm({
  businessId, customerId, requestId, businessDate, crates, bottleTypes,
}: {
  businessId: string;
  customerId: string;
  requestId: string;
  businessDate: string;
  crates: Item[];
  bottleTypes: Item[];
}) {
  // A retried financial opening is immutable, including its effective
  // Lagos date; keep both values even when the server rerenders this form.
  const [originalRequestId] = useState(requestId);
  const [originalBusinessDate] = useState(businessDate);
  const [crateEntries, setCrateEntries] = useState<Entry[]>([]);
  const [bottleEntries, setBottleEntries] = useState<Entry[]>([]);
  const [state, action, pending] = useActionState(saveCustomerOpening, initial);

  return (
    <form action={action}
      className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="business_id" value={businessId} />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="request_id" value={originalRequestId} />
      <input type="hidden" name="business_date" value={originalBusinessDate} />
      <input type="hidden" name="crates"
        value={JSON.stringify(crateEntries.map((x) =>
          ({ type: x.type, quantity: Number(x.quantity) })))} />
      <input type="hidden" name="bottles"
        value={JSON.stringify(bottleEntries.map((x) =>
          ({ type: x.type, quantity: Number(x.quantity) })))} />

      <div>
        <h2 className="text-lg font-bold">Balances from before DepotFlow</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Enter only what was already outstanding. This does not record a
          new sale, payment or deposit collection.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="customer-opening-debt"
            className="block text-sm font-semibold">
            Customer owes depot (₦)
          </label>
          <input id="customer-opening-debt" name="old_debt"
            type="number" inputMode="numeric" min={0} step={1}
            defaultValue={0} required className="mt-2 w-full"
            disabled={pending} />
        </div>
        <div>
          <label htmlFor="customer-opening-held"
            className="block text-sm font-semibold">
            Refundable deposit held (₦)
          </label>
          <input id="customer-opening-held" name="refundable_deposit"
            type="number" inputMode="numeric" min={0} step={1}
            defaultValue={0} required className="mt-2 w-full"
            disabled={pending} />
        </div>
      </div>
      <details className="rounded-xl bg-stone-100 p-3">
        <summary className="cursor-pointer text-sm font-bold">
          Empty crates and bottles the customer owes (optional)
        </summary>
        <p className="mt-2 text-xs leading-5 text-stone-600">
          These are with the customer, NOT empty containers already inside
          the depot. Select their exact type rather than matching pocket count.
        </p>
        <div className="mt-4 space-y-4">
          <OwedTypes label="Empty crates" options={crates}
            entries={crateEntries} onChange={setCrateEntries} />
          <OwedTypes label="Empty bottles" options={bottleTypes}
            entries={bottleEntries} onChange={setBottleEntries} />
        </div>
      </details>
      <div>
        <label htmlFor="customer-opening-note" className="block text-sm font-semibold">
          Source or note (optional)
        </label>
        <input id="customer-opening-note" name="note"
          maxLength={300} className="mt-2 w-full"
          placeholder="e.g. Previous notebook balance"
          disabled={pending} />
      </div>
      <label className="flex min-h-12 items-start gap-3 text-sm leading-6">
        <input type="checkbox" name="confirmed" required
          className="mt-1 size-4 accent-emerald-800" disabled={pending} />
        <span>
          I checked these previous balances. They are not a new sale,
          payment or stock delivery.
        </span>
      </label>
      {state.message && (
        <p role="alert" className="rounded-xl bg-stone-100 p-3 text-sm">
          {state.message}
        </p>
      )}
      <button type="submit" className="primary min-h-12 w-full" disabled={pending}>
        {pending ? "Recording opening balances…" : "Confirm opening balances"}
      </button>
      <p className="text-xs leading-5 text-stone-600">
        This entry saves once. If the customer owes nothing, leave the
        financial fields at zero and confirm their history during the final
        owner review instead of creating a zero-value transaction.
      </p>
    </form>
  );
}
