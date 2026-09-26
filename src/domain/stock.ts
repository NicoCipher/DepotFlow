import { formatQuantity } from "./quantity.ts";

/** A missing stock record is unknown, not a confirmed zero. */
export function stockDescription(
  totalBottles: number | null,
  bottlesPerCrate: number,
): string {
  if (totalBottles === null) return "Stock not recorded";
  if (totalBottles === 0) return "Out of stock";
  return `Available: ${formatQuantity(totalBottles, bottlesPerCrate)}`;
}
