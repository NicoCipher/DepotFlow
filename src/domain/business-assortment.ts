/** DTO returned ONLY by an owner-verified, gated database function. */
export type AssortmentSetup = {
  businessId: string;
  businessStatus: "setup";
  readOnly: true;
  canActivate: false;
  catalogue: { id: string; name: string; manufacturer: string | null; imagePath: string | null }[];
  crateTypes: { id: string; name: string; family: string; pockets: number; variant: string | null }[];
  configuredDrinks: {
    id: string; catalogueId: string | null; name: string;
    crateTypeId: string | null; packSize: number | null;
    sellingPrice: number; active: boolean;
  }[];
};

export function parseBusinessAssortment(value: unknown, businessId: string): AssortmentSetup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.businessId !== businessId || o.businessStatus !== "setup" ||
      o.readOnly !== true || o.canActivate !== false ||
      !Array.isArray(o.catalogue) || !Array.isArray(o.crateTypes) ||
      !Array.isArray(o.configuredDrinks)) return null;
  if (o.catalogue.length > 250 || o.crateTypes.length > 250 || o.configuredDrinks.length > 250) return null;
  const validId = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
  if (!o.catalogue.every((v) => v && typeof v === "object" &&
    validId(v.id) && typeof v.name === "string") ||
      !o.crateTypes.every((v) => v && typeof v === "object" &&
        validId(v.id) && typeof v.name === "string" &&
        typeof v.pockets === "number" && v.pockets > 0) ||
      !o.configuredDrinks.every((v) => v && typeof v === "object" &&
        validId(v.id) && typeof v.name === "string" &&
        typeof v.sellingPrice === "number")) return null;
  return o as AssortmentSetup;
}

export function validateDrinkSetup({
  price, pack, bottlePrice, returnable, bottleType,
}: {
  price: number; pack: number; bottlePrice: number | null;
  returnable: boolean; bottleType: string;
}): string | null {
  if (!Number.isSafeInteger(pack) || pack < 1 || pack > 120) return "Enter a valid bottles-per-crate count.";
  if (!Number.isSafeInteger(price) || price < 50 || price % 50 !== 0) {
    return "Selling price must be a positive multiple of ₦50.";
  }
  if (bottlePrice !== null && (!Number.isSafeInteger(bottlePrice) ||
    bottlePrice < 0 || bottlePrice % 50 !== 0)) {
    return "Loose bottle price must be a multiple of ₦50.";
  }
  if (returnable && !bottleType.trim()) return "Choose the returnable bottle type.";
  if (!returnable && bottleType.trim()) return "Remove bottle return type for non-returnable drinks.";
  return null;
}
