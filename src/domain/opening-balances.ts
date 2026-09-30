import { isSessionExpiredCode } from "./save-errors.ts";
import { validateBusinessDate } from "./stock-count.ts";
export type OpeningInput = {
  amount: string;
  businessDate: string;
  note: string;
  crates: { type: string; quantity: string }[];
  bottles: { type: string; quantity: string }[];
};
export type OpeningValues = {
  amount: number;
  businessDate: string;
  note: string;
  crates: { type: string; quantity: number }[];
  bottles: { type: string; quantity: number }[];
};
export type OpeningState = {
  message?: string;
  errors?: Record<string, string>;
  retryable?: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateOpeningBalances(
  raw: unknown,
  today: string,
): { values?: OpeningValues; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { errors: { form: "Check the opening balances." } };
  const input = raw as Record<string, unknown>;
  const whole = (text: unknown, minimum: number) =>
    typeof text === "string" &&
    /^\d+$/.test(text.trim()) &&
    Number.isSafeInteger(Number(text)) &&
    Number(text) >= minimum &&
    Number(text) <= 2147483647;
  if (!whole(input.amount, 0))
    errors.amount = "Enter a whole amount, zero or more.";
  let businessDate = "";
  try {
    businessDate = validateBusinessDate(String(input.businessDate ?? ""));
    if (businessDate > today)
      errors.businessDate = "Choose today or an earlier date.";
  } catch {
    errors.businessDate = "Choose a valid balance date.";
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 300) errors.note = "Keep the note within 300 characters.";
  const read = (kind: "crates" | "bottles") => {
    const rows = input[kind];
    const result: { type: string; quantity: number }[] = [];
    if (!Array.isArray(rows) || rows.length > 100) {
      errors[kind] = "Use up to 100 types.";
      return result;
    }
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object") {
        errors[`${kind}.${index}.type`] = "Choose a type.";
        return;
      }
      const type = typeof row.type === "string" ? row.type : "";
      if (
        !type.trim() ||
        type.length > 160 ||
        (kind === "crates" && !uuid.test(type))
      )
        errors[`${kind}.${index}.type`] = "Choose an exact type.";
      if (seen.has(type))
        errors[`${kind}.${index}.type`] =
          "This type is already listed. Combine its quantities.";
      seen.add(type);
      if (!whole(row.quantity, 1))
        errors[`${kind}.${index}.quantity`] =
          "Enter a whole quantity greater than zero.";
      result.push({ type, quantity: Number(row.quantity) });
    });
    return result.sort((a, b) => a.type.localeCompare(b.type));
  };
  const crates = read("crates"),
    bottles = read("bottles");
  if (Number(input.amount) === 0 && crates.length === 0 && bottles.length === 0)
    errors.amount = "Enter money owed or add an empty crate or bottle balance.";
  return Object.keys(errors).length
    ? { errors }
    : {
        errors,
        values: {
          amount: Number(input.amount),
          businessDate,
          note,
          crates,
          bottles,
        },
      };
}
export function openingSaveError(
  code?: string,
  message?: string,
): OpeningState {
  if (isSessionExpiredCode(code))
    return {
      message:
        "Your session has expired. Sign in again, then reopen Opening Balances.",
    };
  if (code === "22023") {
    const known: Record<string, string> = {
      opening_already_recorded:
        "Opening balances have already been recorded for this customer. Reopen this page to view them.",
      opening_request_changed:
        "This form may already have saved different details. Reopen Opening Balances to check.",
      opening_customer_unavailable:
        "This customer is unavailable or archived. Return to Manage Customer.",
      opening_crate_unavailable:
        "A crate type is no longer available. Reopen this page and choose the exact crate type.",
      opening_bottle_unavailable:
        "A bottle type is no longer available. Reopen this page and check the type.",
      opening_invalid: "Check the amounts, quantities and date before saving.",
    };
    if (message && known[message]) return { message: known[message] };
  }
  if (code === "22003")
    return {
      message:
        "One of these balances is too large. Check the amount and quantities.",
    };
  return {
    message:
      "Could not confirm the save. Your entries are kept. Retry these same balances; they will not be added twice.",
    retryable: true,
  };
}
