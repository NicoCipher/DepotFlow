"use client";
import { useEffect } from "react";
import Link from "next/link";
import { crateLabel, crateNeedsSetup, type CrateChoice } from "@/domain/crate-types";
import { refreshCrateTypes } from "@/app/(shop)/crate-types/actions";
export function CrateTypeSelector({
  types,
  selected,
  onChange,
  disabled,
  error,
  onRefresh,
  onAdd,
}: {
  types: CrateChoice[];
  selected: string;
  onChange: (id: string) => void;
  disabled: boolean;
  error?: string;
  onRefresh: (types: CrateChoice[]) => void;
  onAdd: () => void;
}) {
  useEffect(() => {
    async function refresh() {
      try {
        onRefresh(await refreshCrateTypes());
      } catch {
        /* Retain existing choices while offline. */
      }
    }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [onRefresh]);
  return (
    <div className="space-y-3">
      <label htmlFor="crate_type_id">Which crate does this drink use?</label>
      <p className="text-sm text-stone-600">
        Choose the crate this drink comes in. We will fill in how many bottles it holds.
      </p>
      <select
        id="crate_type_id"
        name="crate_type_id"
        value={selected}
        required
        disabled={disabled}
        className="min-h-12 w-full rounded-md border border-stone-400 bg-white p-3"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "crate-type-error" : undefined}
        onFocus={async () => {
          try {
            onRefresh(await refreshCrateTypes());
          } catch {
            /* Keep the loaded choices if disconnected. */
          }
        }}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose physical crate</option>
        {types
          .filter((crate) => !crateNeedsSetup(crate) || crate.id === selected)
          .map((crate) => (
            <option key={crate.id} value={crate.id}>
              {crateLabel({ ...crate, pocket_count: null })}
              {crate.pocket_count !== null ? ` · ${crate.pocket_count} bottles` : ""}
              {crateNeedsSetup(crate) ? " — Needs setup" : ""}
            </option>
          ))}
      </select>
      {!types.some((crate) => !crateNeedsSetup(crate)) && (
        <p className="text-sm text-stone-600">No crates ready to choose. Add the crate this drink comes in below.</p>
      )}
      {error && (
        <p id="crate-type-error" role="alert" className="text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-x-5 [&_a]:min-h-12 [&_a]:py-3">
        <button type="button" className="secondary" disabled={disabled} onClick={onAdd}>Add a missing crate</button>
        <Link
          className="quiet-link"
          href="/crate-types"
          target="_blank"
          rel="noopener"
          title="Opens in a new tab"
        >
          Edit saved crates (new tab)
        </Link>
      </div>

    </div>
  );
}
