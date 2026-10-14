"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RecordKind, RecordMethod, RecordRange } from "@/domain/records";

const types: { value: RecordKind; label: string }[] = [
  { value: "all", label: "All records" },
  { value: "sale", label: "Sales" },
  { value: "payment", label: "Payments" },
  { value: "empties", label: "Empties returned" },
  { value: "opening", label: "Opening balances" },
];
type Period = RecordRange | "custom";

export function RecordsFilterPanel({
  kind, method, range, from, to, query, customDates,
}: {
  kind: RecordKind;
  method: RecordMethod;
  range: RecordRange;
  from: string;
  to: string;
  query: string;
  customDates: boolean;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [period, setPeriod] = useState<Period>(customDates ? "custom" : range);
  const advancedCount = Number(kind !== "all") + Number(method !== "all") +
    Number(customDates || range !== "30d");

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (root.current?.open && event.target instanceof Node && !root.current.contains(event.target))
        root.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && root.current?.open) {
        root.current.open = false;
        root.current.querySelector<HTMLElement>("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <details ref={root} className="group relative shrink-0">
      <summary aria-label={advancedCount ? `Filter records, ${advancedCount} active filters` : "Filter records"}
        className="flex min-h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-emerald-950 shadow-sm transition hover:border-emerald-700 hover:bg-emerald-50 sm:px-4 [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M7 12h10M10 17h4" />
          <circle cx="7" cy="7" r="2" fill="white" stroke="currentColor"/>
        </svg>
        <span className="hidden sm:inline">Filters</span>
        {advancedCount > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-emerald-800 text-[11px] text-white" aria-hidden="true">{advancedCount}</span>
        )}
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_18px_60px_rgba(12,46,32,.20)] sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Filter records</h2>
            <p className="mt-0.5 text-xs text-stone-600">Narrow down your history</p>
          </div>
          <Link href="/records" className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-emerald-900 underline underline-offset-4">Reset</Link>
        </div>
        <form action="/records" method="get" className="grid gap-4">
          {query && <input type="hidden" name="q" value={query} />}
          <div>
            <label htmlFor="records-kind" className="mb-1.5 block text-sm font-semibold">Record type</label>
            <select id="records-kind" name="kind" defaultValue={kind} className="min-h-12 w-full">
              {types.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="records-method" className="mb-1.5 block text-sm font-semibold">Payment method</label>
            <select id="records-method" name="method" defaultValue={method} className="min-h-12 w-full">
              <option value="all">Any method</option>
              <option value="cash">Cash</option>
              <option value="transfer">Bank transfer</option>
              <option value="pos">POS</option>
              <option value="not_recorded">Not recorded</option>
            </select>
          </div>
          <div>
            <label htmlFor="records-period" className="mb-1.5 block text-sm font-semibold">When</label>
            <select id="records-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}
              className="min-h-12 w-full">
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
              <option value="custom">Choose dates…</option>
            </select>
            <input type="hidden" name="range" value={period === "custom" ? "30d" : period} />
          </div>
          {period === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="records-from" className="mb-1.5 block text-sm font-semibold">From</label>
                <input id="records-from" name="from" type="date" defaultValue={customDates ? from : ""}
                  required className="min-h-12 min-w-0 w-full" />
              </div>
              <div>
                <label htmlFor="records-to" className="mb-1.5 block text-sm font-semibold">To</label>
                <input id="records-to" name="to" type="date" defaultValue={customDates ? to : ""}
                  required className="min-h-12 min-w-0 w-full" />
              </div>
            </div>
          )}
          <button type="submit" className="primary min-h-12 w-full">Show matching records →</button>
        </form>
      </div>
    </details>
  );
}
