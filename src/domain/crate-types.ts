import type { Database } from "../types/database";
export type CrateType = Database["public"]["Tables"]["crate_types"]["Row"];
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
  const name = crate.name?.trim().toLowerCase();
  return [
    includeFamily ? crate.empty_family : null,
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
export function crateNeedsSetup(crate: CrateAttributes): boolean {
  return (
    crate.is_legacy === true ||
    crate.pocket_count === null ||
    !crate.empty_family
  );
}
export function crateFitsProduct(
  pocketCount: number | null,
  bottles: number,
): boolean {
  return pocketCount === null || pocketCount === bottles;
}
export function crateMatches(
  crate: CrateAttributes,
  family: string,
  pockets: string,
): boolean {
  return (
    (!family || crate.empty_family === family) &&
    (!pockets || String(crate.pocket_count) === pockets)
  );
}
export function validateCrateType(values: {
  name: string;
  empty_family: string;
  pocket_count: string;
  variant: string;
}) {
  const name = values.name.trim(),
    empty_family = values.empty_family.trim(),
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
    pocket_count > 2147483647
  )
    throw new Error("Enter a name, family and positive whole pocket count.");
  return { name, empty_family, pocket_count, variant };
}
