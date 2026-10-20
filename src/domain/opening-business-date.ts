/**
 * Date pinned to the first render of a physical opening-count request.
 * The same hidden form date is reused on failed/lost-response retries,
 * even when Africa/Lagos crosses midnight before the owner retries.
 */
export function businessDateInLagos(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validCapturedOpeningDate(value: unknown, now: Date = new Date()): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value <= businessDateInLagos(now);
}
