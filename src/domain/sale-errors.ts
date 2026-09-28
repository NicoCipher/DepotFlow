export const saleNetworkMessage =
  "Couldn’t connect. Your sale is still here. Try again.";

export const saleSaveUncertainMessage =
  "Couldn’t confirm whether this sale was saved. Tap Check Sale to verify. Don’t change the sale yet.";

export const saleSessionExpiredMessage =
  "Sign in again to continue this sale.";

export function isSaleSessionExpired(
  hasUser: boolean,
  authError: { status?: number; name?: string; message?: string } | null,
): boolean {
  if (hasUser) return false;
  if (!authError) return true;
  if ([400, 401, 403].includes(authError.status ?? 0)) return true;
  return /session missing|refresh token|jwt.*expired|authsessionmissing/i.test(
    `${authError.name ?? ""} ${authError.message ?? ""}`,
  );
}


export const saleUnexpectedMessage =
  "Something went wrong. Your sale is still here. Try again.";

const safeDomainSalePatterns = [
  /^Review current prices and stock before saving\.$/,
  /^Review the drinks in this sale\.$/,
  /^That total is too large\.$/,
  /^.+ price is not set\.$/,
  /^Enter whole numbers, zero or more\.$/,
  /^That fraction does not make a whole number of bottles\.$/,
  /^Stock has not been counted for this drink yet\.$/,
  /^Out of stock\. Change the quantity\.$/,
  /^Only .+ available now\. Change the quantity\.$/,
  /^Check this drink’s prices\.$/,
  /^Choose a drink\.$/,
  /^Review duplicate drinks\.$/,
  /^Check the bottle quantity\.$/,
  /^Enter whole numbers of returned empties\.$/,
  /^Returned empties cannot exceed those in this sale\.$/,
  /^Check the highlighted empties fields\.$/,
  /^A drink is no longer available\.$/,
  /^.+: Check the bottle quantity\.$/,
  /^That quantity is too large\.$/,
  /^(Crate|Bottle) type is no longer available\. Review the empties\.$/,
  /^Physical crates taken cannot exceed whole crates sold\.$/,
  /^Add drinks before recording empties\.$/,
  /^.+: Crate details are not finished\./,
  /^.+: The physical crate does not match the bottles per crate\./,
  /^.+: The empty bottle name is missing\./,
  /^This customer requires a deposit for missing empties\./,
];

export function safeSaleDomainMessage(cause: unknown): string | null {
  if (!(cause instanceof Error)) return null;
  return safeDomainSalePatterns.some((pattern) => pattern.test(cause.message))
    ? cause.message
    : null;
}

const databaseSaleMessages: Record<string, string> = {
  "Check the sale details.": "Check the sale details and try again.",
  "This sale request was already used with different details.":
    "This sale changed after saving started. Review it before trying again.",
  "Returned empties contain duplicate types.":
    "The same returned empty was counted twice. Review the empties.",
  "Check the returned crates.": "Check the returned crates and try again.",
  "A returned crate type is no longer available.":
    "A returned crate is no longer available. Review the empties.",
  "Check the returned bottles.": "Check the returned bottles and try again.",
  "A returned bottle type is no longer available.":
    "A returned bottle is no longer available. Review the empties.",
  "Review duplicate drinks.": "The same drink was added twice. Review the sale.",
  "A drink no longer exists. Review the sale.":
    "A drink is no longer available. Remove it from this sale.",
  "Price or product details changed. Review the sale.":
    "A price or drink detail changed. Review the sale and try again.",
  "Enter whole quantities of drinks and empties.":
    "Use whole numbers for drinks and empties.",
  "That fraction does not make whole bottles.":
    "That partial-crate quantity does not make a whole number of bottles.",
  "That quantity is too large.": "That quantity is too large.",
  "Check returned empties.": "Check the returned empties and try again.",
  "Choose an exact crate type for this drink before saving.":
    "This drink’s physical crate setup is incomplete. Finish the drink setup before saving.",
  "A price is missing. Review the sale.":
    "A drink price is missing. Review the sale.",
  "Set a partial-crate price override because the full-crate price does not divide into whole naira.":
    "This partial-crate price cannot be calculated in whole naira. Set a half or quarter price for the drink.",
  "Sale total is too large.": "The sale total is too large.",
  "Not enough stock. Review the sale.":
    "Stock changed before the sale finished. Review the quantities and try again.",
  "Returned empties cannot settle more than physically came back.":
    "Returned empties do not match this sale. Review what came back.",
  "This customer requires an empties deposit. Deposit handling is not enabled for shortages yet.":
    "This customer requires a deposit for missing empties. Deposit collection is not available yet.",
  "Amount paid cannot exceed the total.":
    "Amount paid cannot be more than the sale total.",
};

export function safeSaleDatabaseMessage(
  error: { code?: string | null; message?: string | null },
): string | null {
  if (error.code !== "22023" || !error.message) return null;
  return databaseSaleMessages[error.message] ?? null;
}
