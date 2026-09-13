import { validateBusinessDate } from "./stock-count.ts";

export function emptyCrateQuantity(quantity: number | null): string {
  if (quantity === null) return "Not recorded";
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647)
    throw new Error("Empty crate count is not valid.");
  return `${quantity} ${quantity === 1 ? "crate" : "crates"}`;
}
export function emptyCrateCountPreview(
  raw: string,
  businessDate: string,
  previousQuantity: number | null,
) {
  const quantity = Number(raw.trim());
  if (
    !/^\d+$/.test(raw.trim()) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0 ||
    quantity > 2147483647
  )
    throw new Error("Enter a whole number of crates, zero or more.");
  validateBusinessDate(businessDate);
  emptyCrateQuantity(previousQuantity);
  return { quantity, businessDate, previousQuantity };
}
export type EmptyCrateCountState = {
  quantity: string;
  businessDate: string;
  message?: string;
  review?: ReturnType<typeof emptyCrateCountPreview>;
};
