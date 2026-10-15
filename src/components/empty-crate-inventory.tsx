"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CrateDisplay } from "@/components/crate-display";
import type { Database } from "@/types/database";
import type { BreweryCrateGroup } from "@/domain/empty-crate-summary";

type Crate = Database["public"]["Views"]["known_empty_crates"]["Row"];
type View = "all" | "available" | "uncounted";

export function EmptyCrateInventory({ groups }: { groups: BreweryCrateGroup<Crate>[] }) {
  const [query, setQuery] = useState("");
  const [brewery, setBrewery] = useState("all");
  const [view, setView] = useState<View>("all");
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return groups
      .filter(group => brewery === "all" || group.brewery === brewery)
      .map(group => ({
        ...group,
        crates: group.crates.filter(crate => {
          if (view === "available" && !(crate.quantity !== null && crate.quantity > 0)) return false;
          if (view === "uncounted" && crate.quantity !== null) return false;
          return !search || [crate.name, crate.variant, crate.empty_family, crate.pocket_count]
            .some(part => String(part ?? "").toLocaleLowerCase().includes(search));
        }),
      }))
      .filter(group => group.crates.length > 0);
  }, [groups, brewery, query, view]);
  const filtering = query.trim() !== "" || brewery !== "all" || view !== "all";
  const matching = visible.reduce((total, group) => total + group.crates.length, 0);
  return (
    <section aria-label="Crate stock by brewery" className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <label htmlFor="search-empty-crates" className="block text-sm font-semibold text-stone-950">
          Find an empty crate
        </label>
        <input id="search-empty-crates" type="search" autoComplete="off"
          placeholder="Search Heineken, 33, Trophy…"
          value={query} onChange={event => setQuery(event.target.value)} />
        <label htmlFor="crate-brewery" className="block text-sm font-semibold text-stone-950">Brewery</label>
        <select id="crate-brewery" value={brewery} onChange={event => setBrewery(event.target.value)}
          className="min-h-12 w-full rounded-md border border-stone-300 bg-white px-3">
          <option value="all">All breweries</option>
          {groups.map(group => <option key={group.brewery} value={group.brewery}>{group.brewery}</option>)}
        </select>
        <div className="flex flex-wrap gap-2" aria-label="Filter counted crates">
          {([["all", "All types"], ["available", "In depot"], ["uncounted", "Not counted"]] as const)
            .map(([value, label]) => (
              <button key={value} type="button" aria-pressed={view === value}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium ${view === value
                  ? "border-emerald-900 bg-emerald-900 text-white"
                  : "border-stone-200 bg-white text-stone-700"}`}
                onClick={() => setView(value)}>{label}</button>
            ))}
        </div>
        <p className="text-xs text-stone-600" role="status">
          {matching} matching physical crate {matching === 1 ? "type" : "types"}
          {filtering ? " · The depot grand total above does not change with filters." : ""}
        </p>
      </div>
      {visible.map((group, index) => {
        const shownTotal = group.crates.reduce((n, crate) => n + (crate.quantity ?? 0), 0);
        return (
          <details key={group.brewery} open={index === 0} className="group rounded-2xl border border-stone-200 bg-white">
            <summary className="flex min-h-16 cursor-pointer items-center justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="block break-words font-bold text-stone-950">{group.brewery}</span>
                <span className="block text-xs text-stone-600">
                  {group.crates.length} {filtering ? "matching " : ""}crate {group.crates.length === 1 ? "type" : "types"}
                  {group.missingCounts > 0 && !filtering ? ` · ${group.missingCounts} not counted` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-2xl font-semibold tabular-nums">{filtering ? shownTotal : group.countedTotal}</span>
                <span className="block text-xs text-stone-500">{filtering ? "matching counted crates" : "counted crates"}</span>
              </span>
            </summary>
            <ul className="divide-y divide-stone-100 border-t border-stone-200">
              {group.crates.map(crate => (
                <li key={crate.crate_type_id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0"><CrateDisplay crate={crate} includeFamily={false} /></div>
                    <div className="shrink-0 text-right">
                      {crate.quantity === null ? (
                        <span className="text-sm font-semibold text-amber-900">Not counted</span>
                      ) : (
                        <>
                          <p className="text-xl font-bold tabular-nums">{crate.quantity.toLocaleString()}</p>
                          <p className="text-xs text-stone-500">empty crates</p>
                        </>
                      )}
                    </div>
                  </div>
                  <Link className="mt-3 flex min-h-11 items-center justify-between border-t border-stone-100 pt-2 text-sm font-semibold text-emerald-900"
                    href={`/empty-crates/count?type=${crate.crate_type_id}`}>
                    {crate.quantity === null ? "Record first count" : "Update count"}
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
      {visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 p-6">
          <p className="font-semibold">No crate types match</p>
          <p className="mt-2 text-sm text-stone-600">Try another brewery or search, or show all types.</p>
          <button type="button" className="secondary mt-4" onClick={() => { setView("all"); setQuery(""); setBrewery("all"); }}>Clear filters</button>
        </div>
      )}
    </section>
  );
}
