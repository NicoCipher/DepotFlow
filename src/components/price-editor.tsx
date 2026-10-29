"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { formatNaira, roundUpToSellingPriceStep } from "@/domain/products";
import { saveBulkPrices } from "@/app/(shop)/products/price-actions";

export type PriceEditorRow = {
  id: string;
  name: string;
  size: string | null;
  bottlesPerCrate: number;
  fullCratePrice: number;
  halfCratePrice: number | null;
  quarterCratePrice: number | null;
  bottlePrice: number | null;
  catalogueProductId: string | null;
  costPrice: number | null;
};

type DraftRow = PriceEditorRow & { costText: string; crateText: string; halfText: string; quarterText: string; bottleText: string };

function sameOptionalPrice(value: string, current: number | null) {
  if (!value.trim()) return current === null;
  return /^\d+$/.test(value) && Number(value) === current;
}

function roundedSellingText(value: string): string {
  if (!/^\\d+$/.test(value)) return value;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount > 2_147_483_600) return value;
  return String(roundUpToSellingPriceStep(amount));
}

function difference(oldValue: number | null, newValue: number | null) {
  if (oldValue === null || newValue === null) return "";
  const delta = newValue - oldValue;
  if (delta === 0) return "no change";
  return `${delta > 0 ? "+" : "−"}${formatNaira(Math.abs(delta))}`;
}

export function PriceEditor({ initialRows }: { initialRows: PriceEditorRow[] }) {
  const [rows, setRows] = useState<DraftRow[]>(() => initialRows.map((row) => ({
    ...row,
    costText: row.costPrice === null ? "" : String(row.costPrice),
    crateText: String(row.fullCratePrice),
    halfText: row.halfCratePrice === null ? "" : String(row.halfCratePrice),
    quarterText: row.quarterCratePrice === null ? "" : String(row.quarterCratePrice),
    bottleText: row.bottlePrice === null ? "" : String(row.bottlePrice),
  })));
  const [search, setSearch] = useState("");
  const [review, setReview] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [actionState, action, pending] = useActionState(saveBulkPrices, {});

  useEffect(() => {
    let active = true;
    let restoredRows: DraftRow[] | null = null;
    let notice = "";
    try {
      const raw = sessionStorage.getItem("depotflow-price-editor-draft-v1");
      if (raw) {
        const saved = JSON.parse(raw) as { rows?: DraftRow[] };
        const savedRows = saved.rows;
        const sameBaseline = Array.isArray(savedRows)
          && savedRows.length === initialRows.length
          && initialRows.every((current) => {
            const prior = savedRows.find((row) => row.id === current.id);
            return prior
              && prior.fullCratePrice === current.fullCratePrice
              && prior.halfCratePrice === current.halfCratePrice
              && prior.quarterCratePrice === current.quarterCratePrice
              && prior.bottlePrice === current.bottlePrice
              && prior.costPrice === current.costPrice
              && prior.catalogueProductId === current.catalogueProductId
              && typeof prior.costText === "string"
              && typeof prior.crateText === "string"
              && typeof prior.halfText === "string"
              && typeof prior.quarterText === "string"
              && typeof prior.bottleText === "string";
          });
        if (sameBaseline && savedRows) {
          restoredRows = initialRows.map((current) => {
            const prior = savedRows.find((row) => row.id === current.id)!;
            return { ...current, costText: prior.costText, crateText: prior.crateText, halfText: prior.halfText, quarterText: prior.quarterText, bottleText: prior.bottleText };
          });
          notice = "Your unsaved edits were restored.";
        } else {
          sessionStorage.removeItem("depotflow-price-editor-draft-v1");
          notice = "Prices changed since the saved draft. The current prices are shown.";
        }
      }
    } catch {
      notice = "Could not restore the draft. Current prices are shown.";
    }
    queueMicrotask(() => {
      if (!active) return;
      if (restoredRows) setRows(restoredRows);
      setDraftNotice(notice);
      setDraftReady(true);
    });
    return () => { active = false; };
  }, [initialRows]);

  useEffect(() => {
    try {
      if (!draftReady) return;
      if (actionState.saved) {
        sessionStorage.removeItem("depotflow-price-editor-draft-v1");
        return;
      }
      const hasEdits = rows.some((row) =>
        row.crateText !== String(row.fullCratePrice)
        || !sameOptionalPrice(row.bottleText, row.bottlePrice)
        || !sameOptionalPrice(row.halfText, row.halfCratePrice)
        || !sameOptionalPrice(row.quarterText, row.quarterCratePrice)
        || (row.catalogueProductId !== null && row.costText.trim() !== ""
          && Number(row.costText) !== row.costPrice)
      );
      if (!hasEdits) {
        sessionStorage.removeItem("depotflow-price-editor-draft-v1");
        return;
      }
      sessionStorage.setItem("depotflow-price-editor-draft-v1", JSON.stringify({ rows }));
    } catch {
      // Editing and saving still work when session storage is unavailable.
    }
  }, [rows, draftReady, actionState.saved]);
  const visibleRows = rows.filter((row) => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    || (row.size ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const changes = useMemo(() => rows.flatMap((row) => {
    const newCrate = row.crateText.trim() === "" ? NaN : Number(row.crateText);
    const newBottle = row.bottleText.trim() === "" ? null : Number(row.bottleText);
    const newHalf = row.halfText.trim() === "" ? null : Number(row.halfText);
    const newQuarter = row.quarterText.trim() === "" ? null : Number(row.quarterText);
    const newCost = row.costText.trim() === "" ? null : Number(row.costText);
    const changeSelling = newCrate !== row.fullCratePrice
      || !sameOptionalPrice(row.bottleText, row.bottlePrice)
      || !sameOptionalPrice(row.halfText, row.halfCratePrice)
      || !sameOptionalPrice(row.quarterText, row.quarterCratePrice);
    const changeCost = row.catalogueProductId !== null && newCost !== null && newCost !== row.costPrice;
    if (!changeSelling && !changeCost) return [];
    return [{
      product_id: row.id,
      change_selling: changeSelling,
      change_cost: changeCost,
      expected_full_crate_price: row.fullCratePrice,
      new_full_crate_price: newCrate,
      expected_bottle_price: row.bottlePrice,
      new_bottle_price: newBottle,
      expected_half_crate_price: row.halfCratePrice,
      new_half_crate_price: newHalf,
      expected_quarter_crate_price: row.quarterCratePrice,
      new_quarter_crate_price: newQuarter,
      catalogue_product_id: row.catalogueProductId,
      expected_cost_price: row.costPrice,
      new_cost_price: newCost,
    }];
  }), [rows]);
  const invalidRows = rows.filter((row) => {
    const crate = row.crateText.trim();
    const bottle = row.bottleText.trim();
    const half = row.halfText.trim();
    const quarter = row.quarterText.trim();
    const cost = row.costText.trim();
    return !/^\d+$/.test(crate) || !Number.isSafeInteger(Number(crate)) || Number(crate) > 2147483600 || Number(crate) % 50 !== 0
      || [bottle, half, quarter].some((value) => value !== "" && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483600 || Number(value) % 50 !== 0))
      || (cost !== "" && (!/^\d+$/.test(cost) || !Number.isSafeInteger(Number(cost)) || Number(cost) > 2147483600))
      || (row.catalogueProductId === null && cost !== "");
  });
  function update(id: string, field: "costText" | "crateText" | "halfText" | "quarterText" | "bottleText", value: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [field]: value } : row));
    setReview(false);
    setRequestId("");
  }
  const changedFields = rows.reduce((sum, row) => sum
    + Number(row.catalogueProductId !== null && row.costText.trim() !== "" && Number(row.costText) !== row.costPrice)
    + Number(row.crateText.trim() !== "" && Number(row.crateText) !== row.fullCratePrice)
    + Number(!sameOptionalPrice(row.halfText, row.halfCratePrice))
    + Number(!sameOptionalPrice(row.quarterText, row.quarterCratePrice))
    + Number(!sameOptionalPrice(row.bottleText, row.bottlePrice)), 0);
  const serialized = JSON.stringify(changes);
  const unusualChange = changes.some((item) => {
    const row = rows.find((candidate) => candidate.id === item.product_id);
    if (!row) return false;
    const newValues = [
      item.change_cost ? [row.costPrice, item.new_cost_price] as const : null,
      item.change_selling ? [row.fullCratePrice, item.new_full_crate_price] as const : null,
      item.change_selling ? [row.bottlePrice, item.new_bottle_price] as const : null,
      item.change_selling ? [row.halfCratePrice, item.new_half_crate_price] as const : null,
      item.change_selling ? [row.quarterCratePrice, item.new_quarter_crate_price] as const : null,
    ].filter((pair): pair is readonly [number | null, number | null] => pair !== null);
    return newValues.some(([oldValue, newValue]) =>
      newValue === 0 || (oldValue !== null && oldValue > 0 && newValue !== null
        && Math.abs(newValue - oldValue) / oldValue >= 0.5));
  });
  if (actionState.saved) {
    return (
      <section className="mt-5 space-y-4">
        <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-semibold text-emerald-950">{actionState.message ?? "Prices saved."}</p>
        <p className="text-sm text-stone-600">{changedFields} price fields updated. Stock, debts and past sales were not changed.</p>
        <Link className="primary w-full" href="/products">Back to drinks</Link>
      </section>
    );
  }
  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="changes" value={serialized} />
      <input type="hidden" name="request_id" value={requestId} />
      <label htmlFor="price-search">Find a drink</label>
      <input id="price-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type a drink name" />
      {draftNotice && <p role="status" className="text-sm text-stone-600">{draftNotice}</p>}
      <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
        Selling prices round up to the next ₦50 when you leave a field. Example: ₦1,062 becomes ₦1,100. Bottle and pack prices remain independent.
      </p>
      <div className="flex items-center justify-between gap-3 border-b border-stone-300 pb-3 text-sm">
        <span className="text-stone-600">Edit only what you want. Cost needs a catalogue link.</span>
        <span className="shrink-0 font-semibold">{changedFields} changed</span>
      </div>
      {visibleRows.map((row) => {
        const isChanged = changes.some((item) => item.product_id === row.id);
        return (
          <section key={row.id} className="rounded-xl border border-stone-300 p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-semibold">{row.name}</h2>
                {row.size && <p className="text-sm text-stone-600">{row.size}</p>}
              </div>
              <span className={isChanged ? "shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900" : "shrink-0 text-xs text-stone-500"}>
                {isChanged ? "Edited" : "Unchanged"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={row.id + "-cost"}>Buying cost (₦)</label>
                <input id={row.id + "-cost"} type="text" inputMode="numeric" pattern="[0-9]*"
                  value={row.costText} disabled={!row.catalogueProductId || pending}
                  onChange={(event) => update(row.id, "costText", event.target.value)}
                  placeholder={row.catalogueProductId ? "Not recorded" : "Not linked"} />
                {row.costPrice !== null && row.costText !== String(row.costPrice)
                  && <p className="mt-1 text-xs text-stone-600">Was {formatNaira(row.costPrice)}</p>}
              </div>
              <div>
                <label htmlFor={row.id + "-crate"}>Selling / crate (₦)</label>
                <input id={row.id + "-crate"} type="text" inputMode="numeric" pattern="[0-9]*"
                  value={row.crateText} disabled={pending}
                  onChange={(event) => update(row.id, "crateText", event.target.value)}
                  onBlur={() => update(row.id, "crateText", roundedSellingText(row.crateText))} />
                {row.crateText !== String(row.fullCratePrice)
                  && <p className="mt-1 text-xs text-stone-600">Was {formatNaira(row.fullCratePrice)}</p>}
              </div>
              <div>
                <label htmlFor={row.id + "-half"}>Half crate ({row.bottlesPerCrate / 2} bottles, ₦)</label>
                <input id={row.id + "-half"} type="text" inputMode="numeric" pattern="[0-9]*"
                  value={row.halfText} disabled={pending}
                  onChange={(event) => update(row.id, "halfText", event.target.value)}
                  onBlur={() => update(row.id, "halfText", roundedSellingText(row.halfText))}
                  placeholder="Not set" />
                {row.halfText !== (row.halfCratePrice === null ? "" : String(row.halfCratePrice))
                  && <p className="mt-1 text-xs text-stone-600">Was {row.halfCratePrice === null ? "not set" : formatNaira(row.halfCratePrice)}</p>}
              </div>
              <div>
                <label htmlFor={row.id + "-quarter"}>Quarter crate ({row.bottlesPerCrate / 4} bottles, ₦)</label>
                <input id={row.id + "-quarter"} type="text" inputMode="numeric" pattern="[0-9]*"
                  value={row.quarterText} disabled={pending}
                  onChange={(event) => update(row.id, "quarterText", event.target.value)}
                  onBlur={() => update(row.id, "quarterText", roundedSellingText(row.quarterText))}
                  placeholder="Not set" />
                {row.quarterText !== (row.quarterCratePrice === null ? "" : String(row.quarterCratePrice))
                  && <p className="mt-1 text-xs text-stone-600">Was {row.quarterCratePrice === null ? "not set" : formatNaira(row.quarterCratePrice)}</p>}
              </div>
              <div className="col-span-2">
                <label htmlFor={row.id + "-bottle"}>Selling / bottle (₦, optional)</label>
                <input id={row.id + "-bottle"} type="text" inputMode="numeric" pattern="[0-9]*"
                  value={row.bottleText} disabled={pending}
                  onChange={(event) => update(row.id, "bottleText", event.target.value)}
                  onBlur={() => update(row.id, "bottleText", roundedSellingText(row.bottleText))}
                  placeholder="No separate bottle price" />
                {row.bottleText !== (row.bottlePrice === null ? "" : String(row.bottlePrice))
                  && <p className="mt-1 text-xs text-stone-600">Was {row.bottlePrice === null ? "not set" : formatNaira(row.bottlePrice)}</p>}
              </div>
            </div>
          </section>
        );
      })}
      {invalidRows.length > 0 && <p role="alert" className="text-sm text-red-800">Check the prices: selling prices must be whole naira in ₦50 steps. Buying costs must be whole naira.</p>}
      {actionState.message && <p role="alert" className="text-sm text-red-800">{actionState.message}</p>}
      {review ? (
        <section className="space-y-3 rounded-xl border border-stone-400 p-3">
          <h2 className="font-semibold">Review changes</h2>
          {changes.map((item) => {
            const row = rows.find((candidate) => candidate.id === item.product_id)!;
            return (
              <div key={item.product_id} className="border-b border-stone-200 pb-3 last:border-0">
                <p className="font-semibold">{row.name}</p>
                {item.change_cost && <p className="text-sm">Cost: {row.costPrice === null ? "Not set" : formatNaira(row.costPrice)} → {formatNaira(Number(item.new_cost_price))} {difference(row.costPrice, item.new_cost_price)}</p>}
                {item.change_selling && <>
                  <p className="text-sm">Crate: {formatNaira(row.fullCratePrice)} → {formatNaira(Number(item.new_full_crate_price))} {difference(row.fullCratePrice, item.new_full_crate_price)}</p>
                  <p className="text-sm">Bottle: {row.bottlePrice === null ? "Not set" : formatNaira(row.bottlePrice)} → {item.new_bottle_price === null ? "Not set" : formatNaira(item.new_bottle_price)} {difference(row.bottlePrice, item.new_bottle_price)}</p>
                  <p className="text-sm">Half crate ({row.bottlesPerCrate / 2} bottles): {row.halfCratePrice === null ? "Not set" : formatNaira(row.halfCratePrice)} → {item.new_half_crate_price === null ? "Not set" : formatNaira(item.new_half_crate_price)} {difference(row.halfCratePrice, item.new_half_crate_price)}</p>
                  <p className="text-sm">Quarter crate ({row.bottlesPerCrate / 4} bottles): {row.quarterCratePrice === null ? "Not set" : formatNaira(row.quarterCratePrice)} → {item.new_quarter_crate_price === null ? "Not set" : formatNaira(item.new_quarter_crate_price)} {difference(row.quarterCratePrice, item.new_quarter_crate_price)}</p>
                </>}
              </div>
            );
          })}
          {unusualChange && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Check carefully: at least one price is zero or changes by 50% or more. You can still save after reviewing.</p>}
          <p className="text-sm text-stone-600">Only these prices will change. Past sales, stock and debts stay as they are.</p>
          <button className="primary w-full" disabled={pending || invalidRows.length > 0 || changes.length === 0}
            onClick={() => { if (!requestId) setRequestId(crypto.randomUUID()); }}>
            {pending ? "Saving…" : "Confirm and save"}
          </button>
          <button type="button" className="secondary w-full" disabled={pending} onClick={() => { setReview(false); setRequestId(""); }}>Back to editing</button>
        </section>
      ) : (
        <button type="button" className="primary w-full" disabled={pending || invalidRows.length > 0 || changes.length === 0}
          onClick={() => { setRequestId(crypto.randomUUID()); setReview(true); }}>
          Review {changedFields} changes
        </button>
      )}
      <Link className="quiet-link block text-center" href="/products">Cancel</Link>
    </form>
  );
}
