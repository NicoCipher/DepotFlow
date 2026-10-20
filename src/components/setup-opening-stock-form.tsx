"use client";

import { useActionState, useMemo, useState } from "react";
import {
  recordBusinessOpeningCount,
  type OpeningCountState,
} from "@/app/businesses/[businessId]/stock/actions";
import type { AssortmentSetup } from "@/domain/business-assortment";

type Kind = "drink" | "crate" | "bottle";
type Line = { kind: Kind; resource: string };
type Item = { resource: string; label: string; pack?: number };
const initial: OpeningCountState = { message: "" };

export function SetupOpeningStockForm({
  businessId, requestId, businessDate, setup, recorded,
}: {
  businessId: string; requestId: string; businessDate: string;
  setup: AssortmentSetup; recorded: Line[];
}) {
  // Pin request identity and opening date to this mounted form. A Server
  // Action rerender after midnight must not silently replace either one.
  const [originalRequestId] = useState(requestId);
  const [originalBusinessDate] = useState(businessDate);
  const [kind, setKind] = useState<Kind>("drink");
  const [resource, setResource] = useState("");
  const [state, action, pending] = useActionState(recordBusinessOpeningCount, initial);
  const counted = useMemo(
    () => new Set(recorded.map((r) => r.kind + ":" + r.resource)),
    [recorded],
  );
  const items: Record<Kind, Item[]> = {
    drink: setup.configuredDrinks.filter((p) =>
      p.active && p.packSize && Number.isInteger(p.packSize) && p.packSize > 0,
    ).map((p) => ({
      resource: p.id,
      label: p.name + " · " + p.packSize + " bottles/crate",
      pack: p.packSize ?? undefined,
    })),
    crate: setup.crateTypes.map((c) => ({
      resource: c.id,
      label: c.name + " · " + c.family + " · " + c.pockets + " pockets",
    })),
    bottle: Array.from(new Set(
      setup.configuredDrinks
        .filter((p) => p.active && p.returnable && p.bottleType)
        .map((p) => p.bottleType as string),
    )).sort().map((b) => ({ resource: b, label: b })),
  };
  const options = items[kind];
  const selectable = options.filter((o) => !counted.has(kind + ":" + o.resource));
  const selected = selectable.find((o) => o.resource === resource);
  const complete = (k: Kind) => items[k].filter((o) =>
    counted.has(k + ":" + o.resource)).length;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-base font-extrabold text-stone-950">
        Count the items physically in your depot
      </h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        Choose one item, enter its starting quantity, then save. Zero is a
        valid confirmed count. Customer-owed empties are entered separately.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1"
        aria-label="Opening inventory type">
        {([
          ["drink", "Drinks"], ["crate", "Empty crates"], ["bottle", "Empty bottles"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={kind === id}
            onClick={() => { setKind(id); setResource(""); }}
            className={kind === id
              ? "min-h-11 rounded-lg bg-white px-1 py-2 text-xs font-semibold text-stone-950 shadow-sm"
              : "min-h-11 rounded-lg px-1 py-2 text-xs font-semibold text-stone-600"}>
            {label}
            <span className="mt-0.5 block text-[11px] font-normal tabular-nums">
              {complete(id)}/{items[id].length}
            </span>
          </button>
        ))}
      </div>

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="business_id" value={businessId} />
        <input type="hidden" name="request_id" value={originalRequestId} />
        <input type="hidden" name="business_date" value={originalBusinessDate} />
        <input type="hidden" name="kind" value={kind} />
        <div>
          <label htmlFor="opening-stock-resource" className="block text-sm font-bold">
            {kind === "drink" ? "Which drink?" :
              kind === "crate" ? "Which empty crate type?" : "Which empty bottle type?"}
          </label>
          <select id="opening-stock-resource" name="resource"
            required className="mt-2 min-h-12 w-full" value={resource}
            onChange={(e) => setResource(e.target.value)}
            disabled={pending || selectable.length === 0}>
            <option value="">Choose one to count</option>
            {selectable.map((item) =>
              <option key={item.resource} value={item.resource}>{item.label}</option>)}
          </select>
          {!options.length ? (
            <p className="mt-2 text-xs text-stone-600">
              Configure {kind === "drink" ? "your drinks" :
                kind === "crate" ? "physical crate types" : "returnable bottle types"} first.
            </p>
          ) : !selectable.length ? (
            <p className="mt-2 text-xs font-semibold text-emerald-800">
              All selected items in this category are counted.
            </p>
          ) : null}
        </div>

        {kind === "drink" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="opening-full-crates" className="text-sm font-semibold">
                Full crates
              </label>
              <input id="opening-full-crates" name="full_crates"
                type="number" inputMode="numeric" min={0} step={1}
                defaultValue={0} required disabled={pending || !selected}
                className="mt-2 w-full" />
            </div>
            <div>
              <label htmlFor="opening-loose-bottles" className="text-sm font-semibold">
                Loose bottles
              </label>
              <input id="opening-loose-bottles" name="loose_bottles"
                type="number" inputMode="numeric" min={0}
                max={selected?.pack ? selected.pack - 1 : undefined}
                step={1} defaultValue={0} required
                disabled={pending || !selected} className="mt-2 w-full" />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="opening-empty-quantity" className="text-sm font-semibold">
              {kind === "crate" ? "Empty crates in the depot" :
                "Empty bottles in the depot"}
            </label>
            <input id="opening-empty-quantity" name="quantity"
              type="number" inputMode="numeric" min={0} step={1}
              defaultValue={0} required disabled={pending || !selected}
              className="mt-2 w-full" />
          </div>
        )}

        {state.message && (
          <p role="alert" className="rounded-xl bg-stone-100 p-3 text-sm text-stone-800">
            {state.message}
          </p>
        )}
        <button className="primary min-h-12 w-full" disabled={pending || !selected}
          type="submit">
          {pending ? "Saving count…" : "Confirm starting count"}
        </button>
      </form>
      <p className="mt-3 text-xs leading-5 text-stone-600">
        Every item has a one-time starting count. Mistakes require an
        audited adjustment, not another opening record.
      </p>
    </section>
  );
}
