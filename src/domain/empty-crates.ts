import { isSessionExpiredCode } from "./save-errors.ts";
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
  field?: "quantity" | "businessDate";
  review?: ReturnType<typeof emptyCrateCountPreview>;
};
export function emptyCrateSaveError(code?: string, message?: string) {
  if (isSessionExpiredCode(code))
    return { message: "Your session has expired. Sign in again and check empty crate history before saving another count.", retryable: false };
  if (code === "22023") {
    const known: Record<string, string> = {
      "Empty crates changed. Review the count again.": "Empty crates changed since your review. Go back and review the latest count.",
      "This count form has already been used.": "This form may have saved a different count. Check empty crate history before starting another count.",
      "Choose an existing crate type.": "This crate type is no longer available. Choose another crate type.",
      "Enter a whole number of crates, zero or more.": "Enter a whole number of crates, zero or more, then review again.",
      "Choose a valid business date.": "Choose a valid business date and review again.",
    };
    if (message && known[message]) return { message: known[message], retryable: false };
  }
  return { message: "Could not confirm whether this count saved. Retry this exact count; it will not be saved twice.", retryable: true };
}
