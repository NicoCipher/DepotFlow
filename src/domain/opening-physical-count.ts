/** Validate quantities before calling the guarded, atomic database RPC. */
export function parseOpeningQuantity(value: unknown): number | null {
  if (typeof value !== "string" || !/^[0-9]{1,10}$/.test(value.trim())) {
    return null;
  }
  const number = Number(value.trim());
  return Number.isSafeInteger(number) && number <= 2147483647
    ? number : null;
}

export function isValidDrinkOpeningQuantity(
  fullCrates: number | null,
  looseBottles: number | null,
  packSize: number,
): boolean {
  return fullCrates !== null && looseBottles !== null &&
    Number.isInteger(packSize) && packSize > 0 && packSize <= 120 &&
    looseBottles < packSize &&
    fullCrates * packSize + looseBottles <= 2147483647;
}
