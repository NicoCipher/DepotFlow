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
export function crateLabel(crate: CrateAttributes): string {
  return [
    crate.empty_family ?? "Family not recorded",
    crate.pocket_count === null
      ? "Pockets not recorded"
      : `${crate.pocket_count}-pocket`,
    crate.name,
    crate.variant,
    crate.is_legacy ? "Unresolved legacy" : null,
    (crate.id ?? crate.crate_type_id)
      ? `Ref ${(crate.id ?? crate.crate_type_id)!.slice(-12)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
