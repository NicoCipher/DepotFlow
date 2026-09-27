import type {
  DraftLine,
  SaleCatalog,
  SaleDraft,
  SaleProduct,
} from "./sale-builder.ts";
import { saleProductSetupIssue } from "./sale-builder.ts";

export type EmptiesV2State = {
  mode: "exact" | "actual";
  cratesTaken: Record<string, string>;
  returnedCrates: Record<string, string>;
  returnedBottles: Record<string, string>;
};

export const emptyEmptiesV2: EmptiesV2State = {
  mode: "exact",
  cratesTaken: {},
  returnedCrates: {},
  returnedBottles: {},
};

export type EmptiesLineResult = {
  productId: string;
  crateTypeId: string;
  bottleType: string | null;
  cratesOut: number;
  bottlesOut: number;
  cratesSettled: number;
  bottlesSettled: number;
  cratesOwed: number;
  bottlesOwed: number;
};

export type EmptiesSwap = {
  owedCrateTypeId: string;
  returnedCrateTypeId: string;
  quantity: number;
};

export type EmptiesMatchResult = {
  lines: EmptiesLineResult[];
  swaps: EmptiesSwap[];
  unmatchedCrates: Record<string, number>;
  unmatchedBottles: Record<string, number>;
  hasShortage: boolean;
};

function whole(raw: string | undefined, fallback = 0) {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error("Enter whole numbers of empties.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Enter whole numbers of empties.");
  return value;
}

function add(map: Map<string, number>, key: string, amount: number) {
  if (!amount) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function take(map: Map<string, number>, key: string, amount: number) {
  if (!amount) return;
  const current = map.get(key) ?? 0;
  if (amount > current) throw new Error("Empties matching exceeded what came back.");
  const next = current - amount;
  if (next) map.set(key, next);
  else map.delete(key);
}

function productFor(line: DraftLine, catalog: SaleCatalog) {
  const product = catalog.products.find((item) => item.id === line.productId);
  if (!product) throw new Error("A drink is no longer available.");
  return product;
}

function totalReturnableBottles(line: DraftLine, product: SaleProduct) {
  if (!product.bottles_returnable) return 0;
  const fraction =
    (line.quantity.fraction * product.bottles_per_crate) / 4;
  if (!Number.isSafeInteger(fraction))
    throw new Error(`${product.name}: Check the bottle quantity.`);
  const total =
    line.quantity.crates * product.bottles_per_crate +
    fraction +
    line.quantity.bottles;
  if (!Number.isSafeInteger(total)) throw new Error("That quantity is too large.");
  return total;
}

function cratePocket(catalog: SaleCatalog, id: string) {
  return catalog.crateTypes.find((crate) => crate.id === id)?.pocket_count ?? null;
}

function canonicalBottleType(catalog: SaleCatalog, crateTypeId: string) {
  const types = new Set(
    catalog.products
      .filter(
        (product) =>
          product.crate_type_id === crateTypeId &&
          product.bottles_returnable &&
          product.bottle_type,
      )
      .map((product) => product.bottle_type as string),
  );
  return types.size === 1 ? [...types][0] : null;
}

function parseActualCounts(
  values: Record<string, string>,
  allowed: Set<string>,
  label: string,
) {
  const result = new Map<string, number>();
  for (const [id, raw] of Object.entries(values)) {
    if (!allowed.has(id))
      throw new Error(`${label} type is no longer available. Review the empties.`);
    const value = whole(raw);
    if (value) result.set(id, value);
  }
  return result;
}

export function cratesTakenFor(
  draft: SaleDraft,
  line: DraftLine,
): number {
  const state = draft.emptiesV2 ?? emptyEmptiesV2;
  const value = whole(state.cratesTaken[line.productId], line.quantity.crates);
  if (value > line.quantity.crates)
    throw new Error("Physical crates taken cannot exceed whole crates sold.");
  return value;
}

export function actualSaleEmpties(
  draft: SaleDraft,
  catalog: SaleCatalog,
) {
  const match = matchSaleEmpties(draft, catalog);
  const state = draft.emptiesV2 ?? emptyEmptiesV2;
  const crates = new Map<string, number>();
  const bottles = new Map<string, number>();

  if (state.mode === "exact") {
    for (const row of match.lines) {
      add(crates, row.crateTypeId, row.cratesOut);
      if (row.bottleType) add(bottles, row.bottleType, row.bottlesOut);
    }
  } else {
    for (const [id, raw] of Object.entries(state.returnedCrates)) {
      const quantity = whole(raw);
      if (quantity) crates.set(id, quantity);
    }
    for (const [id, raw] of Object.entries(state.returnedBottles)) {
      const quantity = whole(raw);
      if (quantity) bottles.set(id, quantity);
    }
  }

  return {
    crates: [...crates].map(([crateTypeId, quantity]) => ({
      crateTypeId,
      quantity,
    })),
    bottles: [...bottles].map(([bottleType, quantity]) => ({
      bottleType,
      quantity,
    })),
  };
}

export function matchSaleEmpties(
  draft: SaleDraft,
  catalog: SaleCatalog,
): EmptiesMatchResult {
  if (!draft.lines.length) throw new Error("Add drinks before recording empties.");

  const state = draft.emptiesV2 ?? emptyEmptiesV2;
  const results: EmptiesLineResult[] = draft.lines.map((line) => {
    const product = productFor(line, catalog);
    const cratesOut = cratesTakenFor(draft, line);
    const setupIssue = saleProductSetupIssue(product);
    if (setupIssue) throw new Error(`${product.name}: ${setupIssue}`);
    const bottlesOut = totalReturnableBottles(line, product);
    return {
      productId: line.productId,
      crateTypeId: product.crate_type_id,
      bottleType: product.bottle_type,
      cratesOut,
      bottlesOut,
      cratesSettled: 0,
      bottlesSettled: 0,
      cratesOwed: cratesOut,
      bottlesOwed: bottlesOut,
    };
  });

  const actualCrates = new Map<string, number>();
  const actualBottles = new Map<string, number>();

  if (state.mode === "exact") {
    for (const row of results) {
      add(actualCrates, row.crateTypeId, row.cratesOut);
      if (row.bottleType) add(actualBottles, row.bottleType, row.bottlesOut);
    }
  } else {
    const crateIds = new Set(catalog.crateTypes.map((crate) => crate.id));
    const bottleTypes = new Set(
      catalog.products
        .map((product) => product.bottle_type)
        .filter((value): value is string => Boolean(value)),
    );
    for (const [id, value] of parseActualCounts(
      state.returnedCrates,
      crateIds,
      "Crate",
    ))
      actualCrates.set(id, value);
    for (const [id, value] of parseActualCounts(
      state.returnedBottles,
      bottleTypes,
      "Bottle",
    ))
      actualBottles.set(id, value);
  }

  // 1. Exact complete packages settle first.
  for (const row of results) {
    if (!row.bottleType || !row.cratesOwed || row.bottlesOwed <= 0) continue;
    const pocket = cratePocket(catalog, row.crateTypeId);
    if (!pocket) continue;
    const complete = Math.min(
      row.cratesOwed,
      actualCrates.get(row.crateTypeId) ?? 0,
      Math.floor((actualBottles.get(row.bottleType) ?? 0) / pocket),
      Math.floor(row.bottlesOwed / pocket),
    );
    if (!complete) continue;
    take(actualCrates, row.crateTypeId, complete);
    take(actualBottles, row.bottleType, complete * pocket);
    row.cratesSettled += complete;
    row.bottlesSettled += complete * pocket;
    row.cratesOwed -= complete;
    row.bottlesOwed -= complete * pocket;
  }

  // 2. Explicitly allowed swaps only settle as complete packages.
  const swaps: EmptiesSwap[] = [];
  for (const row of results) {
    if (!row.cratesOwed || !row.bottleType) continue;
    const expectedPocket = cratePocket(catalog, row.crateTypeId);
    if (!expectedPocket) continue;
    const allowed = catalog.swapRules
      .filter((rule) => rule.owed_crate_type_id === row.crateTypeId)
      .map((rule) => rule.returned_crate_type_id);

    for (const returnedType of allowed) {
      if (!row.cratesOwed || row.bottlesOwed < expectedPocket) break;
      const returnedPocket = cratePocket(catalog, returnedType);
      const returnedBottleType = canonicalBottleType(catalog, returnedType);
      // Different capacities are never silently treated as equivalent.
      if (
        returnedPocket !== expectedPocket ||
        !returnedBottleType ||
        returnedType === row.crateTypeId
      )
        continue;
      const quantity = Math.min(
        row.cratesOwed,
        actualCrates.get(returnedType) ?? 0,
        Math.floor((actualBottles.get(returnedBottleType) ?? 0) / returnedPocket),
        Math.floor(row.bottlesOwed / expectedPocket),
      );
      if (!quantity) continue;
      take(actualCrates, returnedType, quantity);
      take(actualBottles, returnedBottleType, quantity * returnedPocket);
      row.cratesSettled += quantity;
      row.bottlesSettled += quantity * expectedPocket;
      row.cratesOwed -= quantity;
      row.bottlesOwed -= quantity * expectedPocket;
      const existing = swaps.find(
        (swap) =>
          swap.owedCrateTypeId === row.crateTypeId &&
          swap.returnedCrateTypeId === returnedType,
      );
      if (existing) existing.quantity += quantity;
      else
        swaps.push({
          owedCrateTypeId: row.crateTypeId,
          returnedCrateTypeId: returnedType,
          quantity,
        });
    }
  }

  // 3. An exact physical crate can still settle the crate even when its
  // bottles are incomplete or mixed.
  for (const row of results) {
    if (!row.cratesOwed) continue;
    const quantity = Math.min(
      row.cratesOwed,
      actualCrates.get(row.crateTypeId) ?? 0,
    );
    if (!quantity) continue;
    take(actualCrates, row.crateTypeId, quantity);
    row.cratesSettled += quantity;
    row.cratesOwed -= quantity;
  }

  // 4. Remaining bottles settle only their exact bottle type.
  for (const row of results) {
    if (!row.bottlesOwed || !row.bottleType) continue;
    const quantity = Math.min(
      row.bottlesOwed,
      actualBottles.get(row.bottleType) ?? 0,
    );
    if (!quantity) continue;
    take(actualBottles, row.bottleType, quantity);
    row.bottlesSettled += quantity;
    row.bottlesOwed -= quantity;
  }

  return {
    lines: results,
    swaps,
    unmatchedCrates: Object.fromEntries(actualCrates),
    unmatchedBottles: Object.fromEntries(actualBottles),
    hasShortage: results.some(
      (row) => row.cratesOwed > 0 || row.bottlesOwed > 0,
    ),
  };
}
