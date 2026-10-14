export const recordKinds = ["all", "sale", "payment", "empties", "opening"] as const;
export const recordMethods = ["all", "cash", "transfer", "pos", "not_recorded"] as const;
export const recordRanges = ["today", "7d", "30d", "all"] as const;

export type RecordKind = (typeof recordKinds)[number];
export type RecordMethod = (typeof recordMethods)[number];
export type RecordRange = (typeof recordRanges)[number];

export type CustomerRecord = {
  id: string;
  day: string;
  created_at: string;
  kind: Exclude<RecordKind, "all">;
  customer_id: string;
  customer_name: string;
  business_name: string | null;
  receipt_number: string | null;
  method: string | null;
  sale_total: number;
  received: number;
  remaining: number;
  crates: number;
  bottles: number;
  held_crates: number;
  held_bottles: number;
  status: "paid" | "partial" | "unpaid" | "received" | "recorded" | "voided";
  detail: string;
};
export type CustomerRecordsFeed = { count: number; snapshot: string; items: CustomerRecord[] };

export function recordFilter<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fallback;
}
export function recordSnapshot(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 48 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
export function recordPage(value: unknown): number {
  if (typeof value !== "string" || !/^[0-9]{1,6}$/.test(value)) return 1;
  const n = Number(value);
  return Number.isSafeInteger(n) ? Math.max(1, Math.min(33334, n)) : 1;
}
export function recordDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function shiftRecordDay(day: string, amount: number): string {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function recordDates(now: string, range: RecordRange, from?: unknown, to?: unknown) {
  const specified = Boolean(from || to);
  const lower = recordDate(from);
  const upper = recordDate(to);
  if (specified) {
    return {
      from: lower ?? "",
      to: upper ?? "",
      valid: Boolean(lower && upper && lower <= upper),
      error: !lower || !upper ? "Choose a valid start and end date, or leave both empty." :
        lower > upper ? "The start date cannot be after the end date." : null,
    };
  }
  return {
    from: range === "all" ? "0001-01-01" : range === "today" ? now : shiftRecordDay(now, range === "7d" ? -6 : -29),
    to: now,
    valid: true,
    error: null,
  };
}
export function recordStatus(kind: CustomerRecord["kind"], status: CustomerRecord["status"]) {
  if (status === "voided") return "Voided";
  if (kind === "sale") return status === "paid" ? "Paid in full" : status === "partial" ? "Partly paid" : "Not paid yet";
  if (kind === "payment") return "Payment received";
  return "Recorded";
}
export function recordTypeName(kind: CustomerRecord["kind"]) {
  return ({ sale: "Sale", payment: "Debt payment", empties: "Empties returned", opening: "Opening balances" })[kind];
}
