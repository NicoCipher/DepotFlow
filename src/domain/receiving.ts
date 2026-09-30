import { isSessionExpiredCode } from "./save-errors.ts";
export type ReceivingSnapshot = {
  stock: number;
  empties: number;
  bottlesPerCrate: number;
  crateType: string;
  crateDescription?: string;
  crateTypeId: string;
};
export type ReceivingState = {
  crates: string;
  businessDate: string;
  message?: string;
  field?: "crates" | "businessDate";
  review?: ReceivingSnapshot & {
    crates: number;
    businessDate: string;
    stockAfter: number;
    emptiesAfter: number;
  };
};
export function receivingSaveError(code?: string, message?: string) {
  if (isSessionExpiredCode(code))
    return { message: "Your session has expired. Sign in again and check stock history before receiving more stock.", retryable: false };
  if (code === "22023") {
    const known: Record<string, string> = {
      "Stock or product details changed. Review again.": "Stock or empty crates changed. Go back and review the latest amounts.",
      "Not enough empty crates of this type.": "There are not enough matching empty crates. Go back and check the available amount.",
      "This receiving form has already been used.": "This form may have saved a different receipt. Check stock history before trying again.",
      "This stock form has already been used.": "This form may have saved another stock change. Check stock history before trying again.",
      "Product not found.": "This product is no longer available. Choose another product.",
      "That would exceed the stock limit.": "Receiving these crates would exceed the stock limit. Change the amount and review again.",
      "Enter a positive whole number of crates.": "Enter a positive whole number of crates and review again.",
      "Choose a valid business date.": "Choose a valid business date and review again.",
    };
    if (message && known[message]) return { message: known[message], retryable: false };
  }
  return { message: "Could not confirm whether stock was received. Retry these exact details; they will not be saved twice.", retryable: true };
}
export function receivingPreview(raw: string, snapshot: ReceivingSnapshot) {
  const crates = Number(raw.trim());
  if (
    !/^\d+$/.test(raw.trim()) ||
    !Number.isSafeInteger(crates) ||
    crates <= 0 ||
    crates > 2147483647
  ) {
    throw new Error("Enter a positive whole number of crates.");
  }
  if (
    ![snapshot.stock, snapshot.empties].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    !Number.isSafeInteger(snapshot.bottlesPerCrate) ||
    snapshot.bottlesPerCrate <= 0
  )
    throw new Error("Stock details are not valid.");
  if (crates > snapshot.empties)
    throw new Error("Not enough empty crates of this type.");
  const stockAfter = snapshot.stock + crates * snapshot.bottlesPerCrate;
  if (!Number.isSafeInteger(stockAfter) || stockAfter > 2147483647)
    throw new Error("That would exceed the stock limit.");
  return {
    ...snapshot,
    crates,
    stockAfter,
    emptiesAfter: snapshot.empties - crates,
  };
}
