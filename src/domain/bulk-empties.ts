import type { SaleCatalog } from "./sale-builder";
import type { EmptiesMatchResult } from "./sale-empties";

export type BulkReturnGroup = {
  crateTypeId: string;
  crateName: string;
  bottleType: string;
  pocketCount: number;
  expectedCrates: number;
  expectedBottles: number;
};

/**
 * Show the complete-set shortcut only for high-volume, unambiguous exact
 * type pairs. It must never combine different crate/bottle types or assume
 * that equal capacities make physical empties interchangeable.
 */
export function bulkReturnGroups(result: EmptiesMatchResult, catalog: SaleCatalog, minimum = 10): BulkReturnGroup[] {
  const byCrate = new Map<string, { bottleTypes: Set<string>; crates: number; bottles: number }>();
  const crateTypesByBottle = new Map<string, Set<string>>();
  for (const line of result.lines) {
    if (!line.cratesOut && !line.bottlesOut) continue;
    const info = byCrate.get(line.crateTypeId) ?? { bottleTypes: new Set<string>(), crates: 0, bottles: 0 };
    if (line.bottleType && line.bottlesOut) {
      info.bottleTypes.add(line.bottleType);
      const crates = crateTypesByBottle.get(line.bottleType) ?? new Set<string>();
      crates.add(line.crateTypeId);
      crateTypesByBottle.set(line.bottleType, crates);
    }
    info.crates += line.cratesOut;
    info.bottles += line.bottlesOut;
    byCrate.set(line.crateTypeId, info);
  }
  const groups: BulkReturnGroup[] = [];
  for (const [crateTypeId, info] of byCrate) {
    if (info.crates < minimum || info.bottleTypes.size !== 1) continue;
    const bottleType = [...info.bottleTypes][0];
    if (crateTypesByBottle.get(bottleType)?.size !== 1) continue;
    const crate = catalog.crateTypes.find((type) => type.id === crateTypeId);
    if (!crate || !crate.pocket_count || crate.pocket_count <= 0) continue;
    if (info.bottles < info.crates * crate.pocket_count) continue;
    groups.push({
      crateTypeId, crateName: crate.name, bottleType, pocketCount: crate.pocket_count,
      expectedCrates: info.crates, expectedBottles: info.bottles,
    });
  }
  return groups.sort((a, b) => a.crateName.localeCompare(b.crateName));
}

export type BulkParts = {
  completeSets: number;
  looseCrates: number;
  looseBottles: number;
};

/** A view over the same two exact-type counts, not a new ledger or quantity. */
export function bulkReturnParts(crates: string, bottles: string, pocketCount: number): BulkParts | null {
  if (!/^\d+$/.test(crates) || !/^\d+$/.test(bottles) || !Number.isSafeInteger(pocketCount) || pocketCount <= 0) return null;
  const crateCount = Number(crates);
  const bottleCount = Number(bottles);
  if (!Number.isSafeInteger(crateCount) || !Number.isSafeInteger(bottleCount)) return null;
  const completeSets = Math.min(crateCount, Math.floor(bottleCount / pocketCount));
  return {
    completeSets,
    looseCrates: crateCount - completeSets,
    looseBottles: bottleCount - completeSets * pocketCount,
  };
}

export function updateBulkReturnParts(parts: BulkParts, key: keyof BulkParts, input: string, pocketCount: number): { crates: string; bottles: string } | null {
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(pocketCount) || pocketCount <= 0) return null;
  const count = Number(input);
  if (!Number.isSafeInteger(count)) return null;
  const next = { ...parts, [key]: count };
  const crates = next.completeSets + next.looseCrates;
  const bottles = next.completeSets * pocketCount + next.looseBottles;
  if (!Number.isSafeInteger(crates) || !Number.isSafeInteger(bottles)) return null;
  return { crates: String(crates), bottles: String(bottles) };
}
