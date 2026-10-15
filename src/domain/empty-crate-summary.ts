import { canonicalCrateFamily } from "./crate-types";

export type StockCrate = {
  crate_type_id: string | null;
  name: string | null;
  empty_family: string | null;
  pocket_count: number | null;
  is_legacy: boolean | null;
  quantity: number | null;
};

export type BreweryCrateGroup<T extends StockCrate> = {
  brewery: string;
  crates: T[];
  countedTotal: number;
  missingCounts: number;
};

export type CrateStockSummary<T extends StockCrate> = {
  groups: BreweryCrateGroup<T>[];
  countedTotal: number;
  missingCounts: number;
};

/**
 * Summaries are views over individual physical crate IDs. Never merge by name,
 * manufacturer, pocket count or permitted swaps; those are not stock identities.
 * An uncounted type is unknown, not zero.
 */
export function summarizeEmptyCrates<T extends StockCrate>(
  crates: readonly T[],
): CrateStockSummary<T> {
  const ids = new Set<string>();
  const buckets = new Map<string, T[]>();
  for (const crate of crates) {
    if (!crate.crate_type_id || ids.has(crate.crate_type_id))
      throw new Error("Empty crate stock contains a missing or repeated identity.");
    ids.add(crate.crate_type_id);
    if (crate.quantity !== null && (!Number.isSafeInteger(crate.quantity) || crate.quantity < 0))
      throw new Error("Invalid empty crate count.");
    const brewery = crate.is_legacy || !crate.empty_family?.trim() || crate.pocket_count === null
      ? "Needs setup"
      : canonicalCrateFamily(crate.empty_family);
    const types = buckets.get(brewery) ?? [];
    types.push(crate);
    buckets.set(brewery, types);
  }
  const groups = [...buckets].map(([brewery, types]) => ({
    brewery,
    crates: [...types].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") ||
      a.crate_type_id!.localeCompare(b.crate_type_id!)),
    countedTotal: types.reduce((n, crate) => n + (crate.quantity ?? 0), 0),
    missingCounts: types.filter(crate => crate.quantity === null).length,
  })).sort((a, b) => a.brewery === "Needs setup" ? 1 :
    b.brewery === "Needs setup" ? -1 : a.brewery.localeCompare(b.brewery));
  return {
    groups,
    countedTotal: groups.reduce((n, group) => n + group.countedTotal, 0),
    missingCounts: groups.reduce((n, group) => n + group.missingCounts, 0),
  };
}
