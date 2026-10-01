"use client";
import { useActionState } from "react";
import { saveEmptyReturn } from "@/app/(shop)/customers/[id]/return-empties/actions";
type Count = { id: string; name: string; owed: number };
export function EmptyReturnForm({
  request,
  customer,
  crates,
  bottles,
  held,
}: {
  request: string;
  customer: string;
  crates: Count[];
  bottles: Count[];
  held: { id: string; kind: string; returned_name: string; quantity: number }[];
}) {
  const [state, action, pending] = useActionState(saveEmptyReturn, {
    message: "",
  });
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="request" value={request} />
      <input type="hidden" name="customer" value={customer} />
      {[
        ["crate", "Correct plastic crates", crates],
        ["bottle", "Correct bottles", bottles],
      ].map(([kind, title, rows]) => (
        <fieldset
          key={String(kind)}
          className="rounded-xl border border-stone-200 bg-white p-4"
        >
          <legend className="px-1 font-semibold">{String(title)}</legend>
          {(rows as Count[]).length ? (
            <div className="space-y-4">
              {(rows as Count[]).map((row) => (
                <label key={row.id} className="block">
                  <span className="block font-semibold">{row.name}</span>
                  <span className="block text-sm text-stone-600">
                    Still owed: {row.owed} · How many came back?
                  </span>
                  <input
                    className="mt-2 w-full"
                    name={`${kind}:${row.id}`}
                    inputMode="numeric"
                    pattern="[0-9]+"
                    maxLength={9}
                    required
                    defaultValue="0"
                    disabled={pending}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-600">None owed.</p>
          )}
        </fieldset>
      ))}
      {held.length > 0 && (
        <fieldset className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <legend className="px-1 font-semibold">
            Held empties you handed back
          </legend>
          <p className="mb-3 text-sm">
            Tick only what the customer collected. Handing these back does not
            reduce their debt.
          </p>
          {held.map((row) => (
            <label
              key={row.id}
              className="flex min-h-14 items-center gap-3 py-2"
            >
              <input
                type="checkbox"
                name="released"
                value={row.id}
                disabled={pending}
                className="h-5 w-5 shrink-0"
              />
              <span>
                {row.quantity} {row.returned_name}{" "}
                {row.kind === "crate" ? "crates" : "bottles"}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {state.message && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
          {state.message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Save empties returned"}
      </button>
    </form>
  );
}
