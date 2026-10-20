import type { Database } from "../types/database";
export type CrateType = Database["public"]["Tables"]["crate_types"]["Row"];
export type CrateChoice = Pick<
  CrateType,
  "id" | "name" | "empty_family" | "pocket_count" | "variant" | "is_legacy"
>;
export type CrateAttributes = {
  id?: string | null;
  crate_type_id?: string | null;
  name: string | null;
  empty_family: string | null;
  pocket_count: number | null;
  variant: string | null;
  is_legacy: boolean | null;
};
export function crateDescription(
  crate: CrateAttributes,
  includeFamily = true,
): string {
  const name = canonicalCrateFamily(crate.name ?? "").toLowerCase();
  return [
    includeFamily && crate.empty_family ? canonicalCrateFamily(crate.empty_family) : null,
    crate.pocket_count === null ? null : `${crate.pocket_count}-pocket`,
    crate.variant?.trim().toLowerCase() === name ? null : crate.variant,
  ]
    .filter(
      (part, index, parts) =>
        part &&
        part.trim().toLowerCase() !== name &&
        parts.findIndex(
          (other) => other?.trim().toLowerCase() === part.trim().toLowerCase(),
        ) === index,
    )
    .join(" · ");
}
export function crateLabel(crate: CrateAttributes): string {
  const description = crateDescription(crate);
  return [crate.name, description].filter(Boolean).join(" · ");
}
/**
 * NB is the established owner-facing brewery family label. Older records and
 * free-text input may say NBL; never show these as two physical-stock groups.
 * This is presentation/setup normalization, NOT a crate compatibility rule.
 */
export function canonicalCrateFamily(family: string): string {
  const trimmed = family.trim();
  return /^(nb|nbl)$/i.test(trimmed) ? "NB" : trimmed;
}

export function crateNeedsSetup(crate: CrateAttributes): boolean {
  return (
    crate.is_legacy === true ||
    crate.pocket_count === null ||
    !crate.empty_family
  );
}
export function showInDailyEmptyCrates(
  crate: CrateAttributes & { quantity: number | null },
  usedByCurrentProduct: boolean,
): boolean {
  return !crateNeedsSetup(crate) || crate.quantity !== null || usedByCurrentProduct;
}
export function crateFitsProduct(
  pocketCount: number | null,
  bottles: number,
): boolean {
  return pocketCount === null || pocketCount === bottles;
}
export function validateCrateType(values: {
  name: string;
  empty_family: string;
  pocket_count: string;
  variant: string;
}) {
  const name = values.name.trim(),
    empty_family = canonicalCrateFamily(values.empty_family),
    variant = values.variant.trim() || null;
  const pocket_count = Number(values.pocket_count.trim());
  if (
    !name ||
    name.length > 120 ||
    !empty_family ||
    empty_family.length > 80 ||
    (variant?.length ?? 0) > 120 ||
    !/^\d+$/.test(values.pocket_count.trim()) ||
    !Number.isSafeInteger(pocket_count) ||
    pocket_count < 1 ||
    pocket_count > 120
  )
    throw new Error("Enter a name, family and 1 to 120 bottle spaces.");
  return { name, empty_family, pocket_count, variant };
}
