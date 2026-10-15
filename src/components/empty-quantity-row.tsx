"use client";

type Props = {
  id: string;
  name: string;
  detail?: string;
  expected: number;
  value: string;
  unit: "crate" | "bottle";
  error?: string;
  onChange: (value: string) => void;
};

export function EmptyQuantityRow({
  id, name, detail, expected, value, unit, error, onChange,
}: Props) {
  const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
  const valid = Number.isSafeInteger(parsed) && parsed >= 0;
  const delta = valid ? expected - parsed : 0;
  const singular = `empty ${unit}`;
  const plural = `empty ${unit}s`;
  const status = error
    ? "Check the quantity"
    : !valid
      ? "Enter a whole number"
      : delta > 0
        ? `${delta} ${delta === 1 ? singular : plural} still owed after this sale`
        : delta < 0
          ? `${-delta} extra ${-delta === 1 ? singular : plural} returned · check separately`
          : "Expected amount returned";

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-[2]">
          <label htmlFor={id} className="block break-words text-sm font-bold text-stone-950">{name}</label>
          {detail && <p className="mt-0.5 text-xs text-stone-600">{detail}</p>}
          <p className="mt-1 text-xs text-stone-600">Expected: {expected} {expected === 1 ? singular : plural}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={name + " returned quantity"}>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 text-xl font-bold text-stone-900 disabled:opacity-40"
            aria-label={"One fewer " + name + " returned"}
            disabled={!valid || parsed === 0}
            onClick={() => onChange(String(parsed - 1))}
          >−</button>
          <input
            id={id}
            className="!h-11 !w-16 min-w-0 !px-1 text-center text-lg font-bold tabular-nums"
            inputMode="numeric"
            pattern="[0-9]+"
            value={value}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? id + "-error" : id + "-status"}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 text-xl font-bold text-stone-900 disabled:opacity-40"
            aria-label={"One more " + name + " returned"}
            disabled={!valid || parsed >= Number.MAX_SAFE_INTEGER}
            onClick={() => onChange(String(parsed + 1))}
          >+</button>
        </div>
      </div>
      {error
        ? <p id={id + "-error"} role="alert" className="mt-2 text-xs font-medium text-red-800">{error}</p>
        : <p id={id + "-status"} className={"mt-2 text-xs font-semibold " + (delta > 0 ? "text-amber-900" : delta < 0 ? "text-stone-700" : "text-emerald-800")}>{status}</p>}
    </div>
  );
}
