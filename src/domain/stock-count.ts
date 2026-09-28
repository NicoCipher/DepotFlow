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
  field?: "crates" | "bottles" | "businessDate";
  review?: ReturnType<typeof stockCountPreview>;
};

export function stockCountSaveError(code?: string, message?: string) {
  if (code === "42501" || code === "PGRST301" || code === "401" || code === "403")
    return { message: "Your session has expired. Sign in again and check stock history before saving another count.", retryable: false };
  if (code === "22023") {
    switch (message) {
      case "Stock or product details changed. Review again.":
        return { message: "Stock changed since your review. Go back and review the latest stock before saving.", retryable: false };
      case "This stock form has already been used.":
        return { message: "This form may have saved a different count. Check stock history before starting another count.", retryable: false };
      case "Product not found.":
        return { message: "This product is no longer available. Choose another product.", retryable: false };
      case "Loose bottles must be fewer than a full crate.":
        return { message: "Loose bottles must be fewer than a full crate. Change the count and review again.", retryable: false };
      case "Enter whole numbers of crates and loose bottles, zero or more.":
      case "That would exceed the stock limit.":
      case "Choose a valid business date.":
        return { message: "Check the count and business date, then review again.", retryable: false };
    }
  }
  return { message: "Could not confirm whether this count saved. Retry this exact count; it will not be saved twice.", retryable: true };
}

export function stockCountInputField(crates: string, bottles: string, businessDate: string): StockCountState["field"] {
  const validNumber = (value: string) => /^\d+$/.test(value.trim()) && Number(value.trim()) <= 2147483647;
  if (!validNumber(crates)) return "crates";
  if (!validNumber(bottles)) return "bottles";
  try { validateBusinessDate(businessDate); } catch { return "businessDate"; }
  return undefined;
}
