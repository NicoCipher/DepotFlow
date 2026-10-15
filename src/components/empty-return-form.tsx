"use client";

import { useActionState, useState } from "react";
import { saveEmptyReturn } from "@/app/(shop)/customers/[id]/return-empties/actions";

type Count = { id: string; name: string; owed: number };
type ReturnRow = Count & { kind: "crate" | "bottle" };

export function EmptyReturnForm({
  request, customer, crates, bottles, held,
}: {
  request: string;
  customer: string;
  crates: Count[];
  bottles: Count[];
  held: { id: string; kind: string; returned_name: string; quantity: number }[];
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [collected, setCollected] = useState<string[]>([]);
  const [state, action, pending] = useActionState(saveEmptyReturn, { message: "" });
  const rows: ReturnRow[] = [
    ...crates.map((row) => ({ ...row, kind: "crate" as const })),
    ...bottles.map((row) => ({ ...row, kind: "bottle" as const })),
  ];
  const amount = (row: ReturnRow) => counts[`${row.kind}:${row.id}`] ?? "0";
  const rawCount = (row: ReturnRow) => {
    const raw = amount(row);
    if (!/^\d{1,9}$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed <= row.owed ? parsed : null;
  };
  const hasInvalid = rows.some((row) => rawCount(row) === null);
  const anyReturned = rows.some((row) => (rawCount(row) ?? 0) > 0);
  const allOwed = rows.length > 0 && rows.every((row) => rawCount(row) === row.owed);
  const totalCratesOwed = crates.reduce((sum, row) => sum + row.owed, 0);
  const totalBottlesOwed = bottles.reduce((sum, row) => sum + row.owed, 0);
  const remainingCrates = crates.reduce((sum, row) => sum + row.owed - (rawCount({ ...row, kind: "crate" }) ?? 0), 0);
  const remainingBottles = bottles.reduce((sum, row) => sum + row.owed - (rawCount({ ...row, kind: "bottle" }) ?? 0), 0);

  function change(row: ReturnRow, raw: string) {
    setCounts((current) => ({ ...current, [`${row.kind}:${row.id}`]: raw }));
  }

  function controls(row: ReturnRow) {
    const value = rawCount(row);
    const noun = row.kind === "crate" ? "empty crates" : "empty bottles";
    const field = `${row.kind}:${row.id}`;
    const inputId = `return-${row.kind}-${encodeURIComponent(row.id)}`;
    return (
      <div key={field} className="rounded-xl border border-stone-200 bg-white p-3">
        <label htmlFor={inputId} className="block text-sm font-bold text-stone-950">
          {row.name} · {noun}
        </label>
        <p className="mt-1 text-xs text-stone-600">{row.owed} owed before this return</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-stone-800">Brought back</span>
          <div className="flex items-center gap-1.5">
            <button type="button" className="secondary !h-11 !w-11 !px-0 text-xl"
              aria-label={`One fewer ${row.name} ${noun} returned`}
              disabled={pending || value === null || value <= 0}
              onClick={() => change(row, String(value! - 1))}>−</button>
            <input id={inputId} name={field} inputMode="numeric" pattern="[0-9]+" maxLength={9} required
              className="!h-11 !w-20 !px-1 text-center text-lg font-bold tabular-nums"
              value={amount(row)} disabled={pending} aria-invalid={value === null}
              aria-describedby={inputId + "-status"}
              onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()}
              onChange={(event) => change(row, event.target.value)} />
            <button type="button" className="secondary !h-11 !w-11 !px-0 text-xl"
              aria-label={`One more ${row.name} ${noun} returned`}
              disabled={pending || value === null || value >= row.owed}
              onClick={() => change(row, String(value! + 1))}>+</button>
          </div>
        </div>
        <p id={inputId + "-status"} className={"mt-2 text-xs font-semibold " + (value === null ? "text-red-800" : value === row.owed ? "text-emerald-800" : "text-amber-900")}>
          {value === null
            ? `Enter a whole number from 0 to ${row.owed}.`
            : value === row.owed
              ? `All ${row.name} ${noun} accounted for`
              : `${row.owed - value} ${row.kind === "crate" ? "empty crates" : "empty bottles"} still owed after this return`}
        </p>
      </div>
    );
  }

  return (
    <form action={action} onReset={(event) => event.preventDefault()} className="space-y-5">
      <input type="hidden" name="request" value={request} />
      <input type="hidden" name="customer" value={customer} />
      <section className="space-y-3" aria-labelledby="return-count-heading">
        <div>
          <h2 id="return-count-heading" className="text-xl font-bold">What did the customer bring back?</h2>
          <p className="mt-1 text-sm text-stone-600">Enter only the empty crates and empty bottles received today. Count each exact type separately.</p>
        </div>
        {rows.length > 0 && (
          <button type="button" className="secondary w-full min-h-12"
            disabled={pending || allOwed}
            onClick={() => setCounts(Object.fromEntries(rows.map((row) => [`${row.kind}:${row.id}`, String(row.owed)])))}>
            {allOwed ? "All owed empty returns entered" : "Everything owed came back"}
          </button>
        )}
        {crates.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-2 font-bold">Empty crates received</legend>
            {crates.map((row) => controls({ ...row, kind: "crate" }))}
          </fieldset>
        )}
        {bottles.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-2 font-bold">Empty bottles received</legend>
            {bottles.map((row) => controls({ ...row, kind: "bottle" }))}
          </fieldset>
        )}
        {rows.length === 0 && <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">No empty crates or empty bottles are currently owed.</p>}
      </section>

      {held.length > 0 && (
        <fieldset className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <legend className="px-1 font-bold">Did the customer collect any different empties we kept aside?</legend>
          <p className="mb-3 text-sm text-amber-950">Select only the held empty crates or empty bottles handed back to the customer. This does not reduce what they owe.</p>
          {held.map((row) => (
            <label key={row.id} className="flex min-h-14 items-center gap-3 py-2">
              <input type="checkbox" name="released" value={row.id}
                checked={collected.includes(row.id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setCollected((current) => checked
                    ? [...current, row.id] : current.filter((id) => id !== row.id));
                }}
                disabled={pending} className="h-5 w-5 shrink-0" />
              <span>{row.quantity} {row.returned_name} {row.kind === "crate" ? "empty crates" : "empty bottles"} were held</span>
            </label>
          ))}
        </fieldset>
      )}

      {(rows.length > 0 || held.length > 0) && (
        <section className="rounded-xl border border-stone-200 bg-stone-50 p-4" aria-live="polite">
          <h2 className="font-bold">After saving this return</h2>
          <div className="mt-2 space-y-1 text-sm">
            <p>Empty crates still owed: <strong>{remainingCrates} of {totalCratesOwed}</strong></p>
            <p>Empty bottles still owed: <strong>{remainingBottles} of {totalBottlesOwed}</strong></p>
            {collected.length > 0 && <p>{collected.length} held {collected.length === 1 ? "entry" : "entries"} handed back separately.</p>}
          </div>
          <p className="mt-2 text-xs text-stone-600">Preview only. Nothing changes until you save. Exact types remain separate.</p>
        </section>
      )}
      {state.message && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">{state.message}</p>}
      <button type="submit" className="primary w-full min-h-12"
        disabled={pending || hasInvalid || (!anyReturned && collected.length === 0)}>
        {pending ? "Saving…" : "Save empty returns"}
      </button>
    </form>
  );
}
