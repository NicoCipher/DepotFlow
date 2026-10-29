"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { formatNaira } from "@/domain/products";
import { saveBulkPrices } from "@/app/(shop)/products/price-actions";

export type PriceEditorRow = {
  id: string;
  name: string;
  size: string | null;
  fullCratePrice: number;
  bottlePrice: number | null;
  catalogueProductId: string | null;
  costPrice: number | null;
};

type DraftRow = PriceEditorRow & { costText: string; crateText: string; bottleText: string };

function sameOptionalPrice(value: string, current: number | null) {
  if (!value.trim()) return current === null;
  return /^\d+$/.test(value) && Number(value) === current;
}

export function PriceEditor({ initialRows }: { initialRows: PriceEditorRow[] }) {
  const [rows, setRows] = useState<DraftRow[]>(() => initialRows.map((row) => ({
    ...row,
    costText: row.costPrice === null ? "" : String(row.costPrice),
    crateText: String(row.fullCratePrice),
    bottleText: row.bottlePrice === null ? "" : String(row.bottlePrice),
  })));
  const [search, setSearch] = useState("");
  const [review, setReview] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [actionState, action, pending] = useActionState(saveBulkPrices, {});
  const visibleRows = rows.filter((row) => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    || (row.size ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const changes = useMemo(() => rows.flatMap((row) => {
    const newCrate = row.crateText.trim() === "" ? NaN : Number(row.crateText);
    const newBottle = row.bottleText.trim() === "" ? null : Number(row.bottleText);
    const newCost = row.costText.trim() === "" ? null : Number(row.costText);
    const changeSelling = newCrate !== row.fullCratePrice || !sameOptionalPrice(row.bottleText, row.bottlePrice);
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
      catalogue_product_id: row.catalogueProductId,
      expected_cost_price: row.costPrice,
      new_cost_price: newCost,
    }];
  }), [rows]);
  const invalidRows = rows.filter((row) => {
    const crate = row.crateText.trim();
    const bottle = row.bottleText.trim();
    const cost = row.costText.trim();
    return !/^\d+$/.test(crate) || !Number.isSafeInteger(Number(crate)) || Number(crate) > 2147483600 || Number(crate) % 50 !== 0
      || (bottle !== "" && (!/^\d+$/.test(bottle) || !Number.isSafeInteger(Number(bottle)) || Number(bottle) > 2147483600 || Number(bottle) % 50 !== 0))
      || (cost !== "" && (!/^\d+$/.test(cost) || !Number.isSafeInteger(Number(cost)) || Number(cost) > 2147483600))
      || (row.catalogueProductId === null && cost !== "");
  });
  function update(id: string, field: "costText" | "crateText" | "bottleText", value: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [field]: value } : row));
    setReview(false);
    setRequestId("");
  }
  const changedFields = changes.reduce((sum, item) => sum + Number(item.change_cost) + Number(item.change_selling), 0);
  const serialized = JSON.stringify(changes);
  if (actionState.saved) {
    return (
      <section className="mt-5 space-y-4">
        <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-semibold text-emerald-950">{actionState.message ?? "Prices saved."}</p>
        <p className="text-sm text-stone-600">{changedFields} price groups updated. Stock, debts and past sales were not changed.</p>
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
      <div className="flex items-center justify-between gap-3 border-b border-stone-300 pb-3 text-sm">
        <span className="text-stone-600">Edit only the prices you want.</span>
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
                {!row.catalogueProductId && <p className="mt-1 text-xs text-stone-500">Cost tracking needs a catalogue link.</p>}
              </div>
              <div>
                <label htmlFor={row.id + "-crate"}>Selling / crate (₦)</label>
                <input id={row.id + "-crate"} type="text" inputMode="numeric" pattern="[0-9]*"
                  value={row.crateText} disabled={pending}
                  onChange={(event) => update(row.id, "crateText", event.target.value)} />
                {row.crateText !== String(row.fullCratePrice)
                  && <p className="mt-1 text-xs text-stone-600">Was {formatNaira(row.fullCratePrice)}</p>}
              </div>
              <div className="col-span-2">
                <label htmlFor={row.id + "-bottle"}>Selling / bottle (₦, optional)</label>
                <input id={row.id + "-bottle"} type="text" inputMode="numeric" pattern="[0-9]*"
                  value={row.bottleText} disabled={pending}
                  onChange={(event) => update(row.id, "bottleText", event.target.value)}
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
                {item.change_cost && <p className="text-sm">Cost: {row.costPrice === null ? "Not set" : formatNaira(row.costPrice)} → {formatNaira(Number(item.new_cost_price))}</p>}
                {item.change_selling && <>
                  <p className="text-sm">Crate: {formatNaira(row.fullCratePrice)} → {formatNaira(Number(item.new_full_crate_price))}</p>
                  <p className="text-sm">Bottle: {row.bottlePrice === null ? "Not set" : formatNaira(row.bottlePrice)} → {item.new_bottle_price === null ? "Not set" : formatNaira(item.new_bottle_price)}</p>
                </>}
              </div>
            );
          })}
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
