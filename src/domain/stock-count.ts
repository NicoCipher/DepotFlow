import { toBottles } from "./quantity.ts";

export function validateBusinessDate(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01" ||
    value > "9999-12-31"
  )
    throw new Error("Choose a valid business date.");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("Choose a valid business date.");
  return value;
}
export function stockCountPreview(
  cratesText: string,
  bottlesText: string,
  businessDate: string,
  stock: number,
  bottlesPerCrate: number,
) {
  const crates = Number(cratesText.trim());
  const bottles = Number(bottlesText.trim());
  if (
    ![cratesText, bottlesText].every((s) => /^\d+$/.test(s.trim())) ||
    ![crates, bottles].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647,
    )
  )
    throw new Error(
      "Enter whole numbers of crates and loose bottles, zero or more.",
    );
  validateBusinessDate(businessDate);
  if (
    !Number.isSafeInteger(stock) ||
    stock < 0 ||
    stock > 2147483647 ||
    !Number.isSafeInteger(bottlesPerCrate) ||
    bottlesPerCrate <= 0
  )
    throw new Error("Stock details are not valid.");
  if (bottles >= bottlesPerCrate)
    throw new Error("Loose bottles must be fewer than a full crate.");
  const stockAfter = toBottles(crates, bottlesPerCrate, bottles);
  if (stockAfter > 2147483647)
    throw new Error("That would exceed the stock limit.");
  return { crates, bottles, businessDate, stock, bottlesPerCrate, stockAfter };
}
export type StockCountState = {
  crates: string;
  bottles: string;
  businessDate: string;
  message?: string;
  review?: ReturnType<typeof stockCountPreview>;
};
