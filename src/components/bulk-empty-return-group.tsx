"use client";

import { useState } from "react";
import { bulkReturnParts, updateBulkReturnParts, type BulkReturnGroup, type BulkParts } from "@/domain/bulk-empties";

type Props = {
  group: BulkReturnGroup;
  returnedCrates: string;
  returnedBottles: string;
  onChange: (counts: { crates: string; bottles: string }) => void;
};

/**
 * One high-volume exact-type pair, still persisted as independent crate and
 * bottle counts. Full sets are just a faster way to enter both quantities.
 */
export function BulkEmptyReturnGroup({ group, returnedCrates, returnedBottles, onChange }: Props) {
  const [showLoose, setShowLoose] = useState(false);
  const parts = bulkReturnParts(returnedCrates, returnedBottles, group.pocketCount);
  if (!parts) return null;
  const incomplete = parts.looseCrates > 0 || parts.looseBottles > 0;
  const showMore = showLoose || incomplete;
  const missingCrates = Math.max(0, group.expectedCrates - Number(returnedCrates));
  const missingBottles = Math.max(0, group.expectedBottles - Number(returnedBottles));

  function adjust(key: keyof BulkParts, value: string) {
    const updated = updateBulkReturnParts(parts!, key, value, group.pocketCount);
    if (updated) onChange(updated);
  }

  function quantity(label: string, key: keyof BulkParts) {
    const value = parts![key];
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 py-3">
        <label htmlFor={`bulk-${group.crateTypeId}-${key}`} className="min-w-0 flex-1 text-sm font-semibold text-stone-900">{label}</label>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className="secondary !h-11 !w-11 !min-w-0 !px-0 text-xl" aria-label={`Remove one ${label.toLowerCase()}`}
            disabled={value <= 0} onClick={() => adjust(key, String(value - 1))}>−</button>
          <input id={`bulk-${group.crateTypeId}-${key}`} inputMode="numeric" pattern="[0-9]+"
            className="!h-11 !w-20 !px-1 text-center text-lg font-bold tabular-nums" value={String(value)}
            onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()}
            onChange={(event) => adjust(key, event.target.value)} />
          <button type="button" className="secondary !h-11 !w-11 !min-w-0 !px-0 text-xl" aria-label={`Add one ${label.toLowerCase()}`}
            disabled={value >= Number.MAX_SAFE_INTEGER} onClick={() => adjust(key, String(value + 1))}>+</button>
        </div>
      </div>
    );
  }

  return (
    <section aria-label={`${group.crateName} bulk empty returns`} className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
      <div className="mb-2">
        <h4 className="font-bold text-stone-950">{group.crateName} · Bulk empty returns</h4>
        <p className="mt-1 text-sm text-stone-600">Count complete empty crates with their matching empty bottles first. Each full set has {group.pocketCount} empty bottles.</p>
      </div>
      {quantity("Complete empty-crate sets", "completeSets")}
      {!showMore && (
        <button type="button" className="secondary mt-2 w-full text-sm" onClick={() => setShowLoose(true)}>
          Some empty crates or empty bottles are incomplete or loose
        </button>
      )}
      {showMore && (
        <div>
          <p className="pt-2 text-xs text-stone-600">Add the remaining empty items separately. Do not count anything twice.</p>
          {quantity("Empty crates without a complete bottle set", "looseCrates")}
          {quantity("Loose empty bottles", "looseBottles")}
          {!incomplete && (
            <button type="button" className="quiet-link mt-1" onClick={() => setShowLoose(false)}>Hide loose returns</button>
          )}
        </div>
      )}
      <div className={"mt-3 rounded-lg p-3 text-sm " + (missingCrates || missingBottles ? "bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-950")} aria-live="polite">
        <p className="font-semibold">{missingCrates || missingBottles ? "Still owed if this sale is saved" : "All expected empty returns received"}</p>
        <p className="mt-1">
          {missingCrates} {missingCrates === 1 ? "empty crate" : "empty crates"} and {missingBottles} {missingBottles === 1 ? "empty bottle" : "empty bottles"} still owed
        </p>
        <p className="mt-1 text-xs opacity-80">Expected: {group.expectedCrates} empty crates and {group.expectedBottles} empty bottles.</p>
      </div>
    </section>
  );
}
