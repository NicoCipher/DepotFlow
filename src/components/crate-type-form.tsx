"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveCrateType } from "@/app/(shop)/crate-types/actions";
import { validateCrateType, type CrateChoice } from "@/domain/crate-types";
export function CrateTypeForm({
  id,
  editing = false,
  initial,
  onSaved,
  onCancel,
}: {
  id: string;
  editing?: boolean;
  initial: Parameters<typeof validateCrateType>[0];
  onSaved?: (crate: CrateChoice) => void;
  onCancel?: () => void;
}) {
  const [submissionId] = useState(id);
  const [values, setValues] = useState(initial);
  const [pocket, setPocket] = useState(
    ["12", "20", "24"].includes(initial.pocket_count)
      ? initial.pocket_count
      : initial.pocket_count
        ? "other"
        : "",
  );
  const [variantOpen, setVariantOpen] = useState(Boolean(initial.variant));
  const [errors, setErrors] = useState<Partial<Record<keyof typeof initial, string>>>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function field(
    key: "name" | "empty_family" | "variant",
    label: string,
    limit: number,
  ) {
    return (
      <div>
        <label htmlFor={key}>{label}</label>
        <input
          id={key}
          value={values[key]}
          maxLength={limit}
          autoFocus={Boolean(onSaved) && key === "name"}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
          required={key !== "variant"}
          onChange={(event) =>
            { setValues({ ...values, [key]: event.target.value });
              setErrors((current) => ({ ...current, [key]: undefined })); }
          }
        />
        {errors[key] && <p id={`${key}-error`} role="alert" className="mt-2 text-sm text-red-800">{errors[key]}</p>}
      </div>
    );
  }
  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        setMessage("");
        setErrors({});
        try {
          validateCrateType(values);
        } catch {
          const nextErrors: typeof errors = {};
          if (!values.name.trim()) nextErrors.name = "Enter the crate name.";
          if (!values.empty_family.trim()) nextErrors.empty_family = "Enter the crate group, such as NB or Guinness.";
          if (!/^\d+$/.test(values.pocket_count.trim()) || Number(values.pocket_count) < 1 || Number(values.pocket_count) > 2147483647) {
            nextErrors.pocket_count = "Enter a whole number of bottle spaces greater than zero.";
          }
          setErrors(nextErrors);
          setMessage("Check the highlighted crate details, then save again.");
          const first = Object.keys(nextErrors)[0];
          document.getElementById(first === "pocket_count" ? (pocket === "other" ? "other-pockets" : "pockets") : first)?.focus();
          return;
        }
        startTransition(async () => {
          try {
            const result = await saveCrateType(submissionId, editing, values);
            if (result.saved) {
              if (onSaved) {
                onSaved({ id: submissionId, ...validateCrateType(values), is_legacy: false });
              } else {
                router.push("/crate-types?saved=1");
                router.refresh();
              }
            } else setMessage(result.message ?? "Could not save.");
          } catch {
            setMessage(
              "Could not connect. Your details are still here. Please try again.",
            );
          }
        });
      }}
    >
      <p className="text-stone-600">Set up the physical crate once, then select it for any drink that uses it.</p>
      <fieldset disabled={pending} className="space-y-5">
        {field("name", "Crate name", 120)}
        <div>
          {field("empty_family", "Which group is the crate?", 80)}
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Common crate groups">
            {["NB", "Guinness", "Trophy"].map((group) => (
              <button key={group} type="button" className="secondary" aria-pressed={values.empty_family === group}
                onClick={() => {
                  setValues((current) => ({ ...current, empty_family: group }));
                  setErrors((current) => ({ ...current, empty_family: undefined }));
                }}>{group}</button>
            ))}
          </div>
          <p className="mt-2 text-sm text-stone-600">Tap a group above, or type another group name.</p>
        </div>
        <div>
          <label htmlFor="pockets">Bottle spaces in the crate</label>
          <p id="pocket-help" className="mb-2 text-sm text-stone-600">
            Example: 12 means the crate holds 12 bottles.
          </p>
          <select
            id="pockets"
            required
            aria-invalid={Boolean(errors.pocket_count)}
            aria-describedby={errors.pocket_count ? "pocket-help pocket-error" : "pocket-help"}
            className="min-h-12 w-full rounded-md border border-stone-400 bg-white p-3"
            value={pocket}
            onChange={(event) => {
              setErrors((current) => ({ ...current, pocket_count: undefined }));
              setPocket(event.target.value);
              setValues({
                ...values,
                pocket_count:
                  event.target.value === "other" ? "" : event.target.value,
              });
            }}
          >
            <option value="">Choose bottle spaces</option>
            {[12, 20, 24].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="other">Other</option>
          </select>
        </div>
        {pocket === "other" && (
          <div>
            <label htmlFor="other-pockets">Other number of bottle spaces</label>
            <input
              id="other-pockets"
              aria-invalid={Boolean(errors.pocket_count)}
              aria-describedby={errors.pocket_count ? "pocket-error" : "pocket-help"}
              inputMode="numeric"
              pattern="[0-9]+"
              required
              maxLength={10}
              value={values.pocket_count}
              onChange={(event) =>
                { setValues({ ...values, pocket_count: event.target.value });
                  setErrors((current) => ({ ...current, pocket_count: undefined })); }
              }
            />
          </div>
        )}
        {errors.pocket_count && <p id="pocket-error" role="alert" className="text-sm text-red-800">{errors.pocket_count}</p>}
        <details open={variantOpen} onToggle={(event) => setVariantOpen(event.currentTarget.open)}>
          <summary className="min-h-12 cursor-pointer py-3 font-semibold">Shape or version (optional)</summary>
          <p className="mb-3 text-sm text-stone-600">Only needed when two crates have similar names but different shapes.</p>
          {field("variant", "Shape / version", 120)}
        </details>
      </fieldset>
      {message && (
        <p role="alert" className="text-red-800">
          {message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : onSaved ? "Save crate and use it" : "Save crate"}
      </button>
      {onCancel ? (
        <button type="button" className="quiet-link w-full text-center" disabled={pending} onClick={onCancel}>Back to drink setup</button>
      ) : (
        <Link className="quiet-link block text-center" href="/crate-types">Cancel</Link>
      )}
    </form>
  );
}
