"use client";
import { useEffect } from "react";
import Link from "next/link";
import {
  crateLabel,
  crateNeedsSetup,
  type CrateType,
} from "@/domain/crate-types";
import { refreshCrateTypes } from "@/app/(shop)/crate-types/actions";
export function CrateTypeSelector({
  types,
  selected,
  onChange,
  disabled,
  error,
  onRefresh,
}: {
  types: CrateType[];
  selected: string;
  onChange: (id: string) => void;
  disabled: boolean;
  error?: string;
  onRefresh: (types: CrateType[]) => void;
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
      <label htmlFor="crate_type_id">Physical crate used for this drink</label>
      <p className="text-sm text-stone-600">
        Choose the actual plastic crate that leaves the depot with this drink. The number of bottle spaces must match the bottles per crate.
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
              {crateLabel(crate)}
              {crateNeedsSetup(crate) ? " — Needs setup" : ""}
            </option>
          ))}
      </select>
      {error && (
        <p id="crate-type-error" role="alert" className="text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-x-5">
        <Link
          className="quiet-link"
          href="/crate-types/new"
          target="_blank"
          rel="noopener"
          title="Opens in a new tab"
        >
          Add a physical crate
        </Link>
        <Link
          className="quiet-link"
          href="/crate-types"
          target="_blank"
          rel="noopener"
          title="Opens in a new tab"
        >
          Manage physical crates
        </Link>
      </div>
    </div>
  );
}
