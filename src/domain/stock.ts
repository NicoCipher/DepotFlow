import { formatQuantity } from "./quantity.ts";

/** A missing stock record is unknown, not a confirmed zero. */
export function stockDescription(
  totalBottles: number | null,
  bottlesPerCrate: number,
): string {
  if (totalBottles === null) return "Stock not recorded";
  const quantity = formatQuantity(totalBottles, bottlesPerCrate);
  return totalBottles === 0 ? "Out of stock · 0 bottles" : quantity;
}
