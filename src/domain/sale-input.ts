export type WholeNumberParse =
  | { ok: true; value: number }
  | { ok: false; reason: "empty" | "format" | "too_large" };

export function parseWholeNumberInput(raw: string): WholeNumberParse {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(value)) return { ok: false, reason: "format" };
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    return { ok: false, reason: "too_large" };
  return { ok: true, value: number };
}

export function wholeNumberInputMessage(
  raw: string,
  label: string,
  options?: { max?: number; maxMessage?: string },
): string | null {
  const parsed = parseWholeNumberInput(raw);
  if (!parsed.ok) {
    if (parsed.reason === "empty") return `Enter ${label}, or 0.`;
    if (parsed.reason === "format") return `Use a whole number for ${label}.`;
    return `${label[0].toUpperCase()}${label.slice(1)} is too large.`;
  }
  if (options?.max !== undefined && parsed.value > options.max)
    return (
      options.maxMessage ??
      `${label[0].toUpperCase()}${label.slice(1)} cannot be more than ${options.max}.`
    );
  return null;
}
