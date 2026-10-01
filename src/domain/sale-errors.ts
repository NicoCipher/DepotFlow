export const saleNetworkMessage =
  "Couldn’t connect. Your sale is still here. Try again.";

export const saleSaveUncertainMessage =
  "Couldn’t confirm whether this sale was saved. Tap Check Sale to verify. Don’t change the sale yet.";

export const saleSessionExpiredMessage = "Sign in again to continue this sale.";

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

export const saleUnexpectedErrorMessage =
  "Something went wrong. Your sale is still here. Try again.";

const safeCaughtSaleMessages: RegExp[] = [
  /^Check the empties choices\.$/,
  /^Choose different empties only for what is still owed\.$/,
  /^The replacement crate must have the same number of spaces\.$/,
  /^Set the crate size before choosing a replacement\.$/,
  /^Empties matching exceeded what came back\.$/,
  /^Choose a valid 24-bottle quantity\.$/,
  /^The crate price does not give a whole-naira price for this bottle quantity\.$/,
  /^Review current prices and stock before saving\.$/,
  /^Review the drinks in this sale\.$/,
  /^That (total|quantity) is too large\.$/,
  /^(Full-crate|Half-crate|Quarter-crate|Bottle) price is not set\.$/,
  /^Set a (half-crate|quarter-crate) price override because the full-crate price does not divide into whole naira\.$/,
  /^Check this drink’s prices\.$/,
  /^Enter whole numbers, zero or more\.$/,
  /^That fraction does not make a whole number of bottles\.$/,
  /^Stock has not been counted for this drink yet\.$/,
  /^Out of stock\. Change the quantity\.$/,
  /^Only .+ available now\. Change the quantity\.$/,
  /^Choose a drink\.$/,
  /^Review duplicate drinks\.$/,
  /^A drink is no longer available(\. Remove it from this sale)?\.$/,
  /^Check the bottle quantity\.$/,
  /^Enter whole numbers of returned empties\.$/,
  /^Returned empties cannot exceed those in this sale\.$/,
  /^Check the highlighted empties fields\.$/,
  /^Empties matching exceeded what came back\.$/,
  /^Physical crates taken cannot exceed whole crates sold\.$/,
  /^Add drinks before recording empties\.$/,
  /^[^:\n]{1,160}: (Check the bottle quantity|Crate details are not finished\. Open this drink and choose the physical crate it uses\.|The physical crate does not match the bottles per crate\. Fix the drink setup before selling it\.|The empty bottle name is missing\. Fix the drink setup before selling it\.)$/,
  /^(Crate|Bottle) type is no longer available\. Review the empties\.$/,
  /^This customer requires a deposit for missing empties\. Deposit handling for shortages is not enabled yet\.$/,
];

export function safeCaughtSaleErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return safeCaughtSaleMessages.some((pattern) => pattern.test(message))
    ? message
    : saleUnexpectedErrorMessage;
}

const safeDatabaseSaleMessages = new Map<string, string>([
  ["Choose a valid 24-bottle quantity.", "Choose a valid 24-bottle quantity."],
  [
    "The crate price does not give a whole-naira price for this bottle quantity.",
    "The crate price does not give a whole-naira price for this bottle quantity.",
  ],
  ["Check the empties choices.", "Check the empties choices."],
  ["Check the sale details.", "Check the sale details and try again."],
  [
    "This sale request was already used with different details.",
    "This sale may already have been saved. Check Sales History before trying again.",
  ],
  [
    "This request was already used for stock.",
    "Could not save this sale safely. Start a new sale and try again.",
  ],
  [
    "Returned empties contain duplicate types.",
    "The same returned empty was entered more than once. Check the empties.",
  ],
  ["Check the returned crates.", "Check the returned crates and try again."],
  [
    "A returned crate type is no longer available.",
    "A returned crate is no longer available. Review the empties.",
  ],
  ["Check the returned bottles.", "Check the returned bottles and try again."],
  [
    "A returned bottle type is no longer available.",
    "A returned bottle is no longer available. Review the empties.",
  ],
  [
    "Review duplicate drinks.",
    "The same drink appears twice. Review the sale.",
  ],
  [
    "A drink no longer exists. Review the sale.",
    "A drink is no longer available. Remove it from this sale.",
  ],
  [
    "Price or product details changed. Review the sale.",
    "Price or drink details changed. Review the sale.",
  ],
  [
    "Enter whole quantities of drinks and empties.",
    "Use whole numbers for drinks and empties.",
  ],
  [
    "That fraction does not make whole bottles.",
    "That part-crate quantity does not make a whole number of bottles.",
  ],
  ["That quantity is too large.", "That quantity is too large."],
  ["Check returned empties.", "Check the returned empties."],
  [
    "Choose an exact crate type for this drink before saving.",
    "This drink’s physical crate setup is incomplete. Fix the drink setup before saving.",
  ],
  [
    "A price is missing. Review the sale.",
    "A price is missing. Review the sale.",
  ],
  [
    "Set a partial-crate price override because the full-crate price does not divide into whole naira.",
    "Set the part-crate price because the full-crate price does not divide into whole naira.",
  ],
  ["Sale total is too large.", "The sale total is too large."],
  [
    "Not enough stock. Review the sale.",
    "Stock changed while saving. Review the quantity and try again.",
  ],
  [
    "Returned empties cannot settle more than physically came back.",
    "Returned empties cannot be more than what physically came back.",
  ],
  [
    "This customer requires an empties deposit. Deposit handling is not enabled for shortages yet.",
    "This customer requires a deposit for the missing empties.",
  ],
  [
    "Amount paid cannot exceed the total.",
    "Amount paid cannot be more than the sale total.",
  ],
]);

export function safeDatabaseSaleErrorMessage(
  code: string | undefined,
  message: string | undefined,
): string {
  if (code !== "22023" || !message) return saleUnexpectedErrorMessage;
  return safeDatabaseSaleMessages.get(message) ?? saleUnexpectedErrorMessage;
}
