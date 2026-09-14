"use client";
import { useState, useTransition } from "react";
import { createCrateType } from "@/app/(shop)/products/crate-actions";
import type { CrateType } from "@/domain/crate-types";
import { productCrateLabel } from "@/domain/product-crate";

const selectStyle =
  "min-h-12 w-full rounded-md border border-stone-400 bg-white p-3";
export function CrateTypeSelector({
  types,
  selected,
  onChange,
  disabled,
  error,
  requestId,
  onBusy,
}: {
  types: CrateType[];
  selected: string;
  onChange: (id: string) => void;
  disabled: boolean;
  error?: string;
  requestId: string;
  onBusy: (busy: boolean) => void;
}) {
  const [options, setOptions] = useState(types);
  const [mode, setMode] = useState<"current" | "choose" | "create">(() =>
    types.find((c) => c.id === selected)?.is_legacy ? "current" : "choose",
  );
  const [family, setFamily] = useState("");
  const [pocket, setPocket] = useState("");
  const [other, setOther] = useState("");
  const [name, setName] = useState("");
  const [variant, setVariant] = useState("");
  const [submissionId, setSubmissionId] = useState(requestId);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const chosen = options.find((c) => c.id === selected);
  const exactOptions = options.filter((c) => !c.is_legacy);
  const pockets = pocket === "other" ? other : pocket;

  function chooseExisting() {
    setMode("choose");
    onBusy(false);
    setMessage("");
  }
  return (
    <fieldset className="space-y-4" disabled={disabled || pending}>
      <legend className="text-lg font-semibold">Physical crate</legend>
      <input type="hidden" name="crate_type_id" value={selected} />
      {mode === "current" ? (
        <>
          <p className="break-words">Current crate: {chosen?.name}</p>
          <p className="text-sm text-stone-600">Needs exact crate setup</p>
          <button
            type="button"
            className="secondary w-full"
            onClick={chooseExisting}
          >
            Set exact crate
          </button>
        </>
      ) : mode === "choose" ? (
        <>
          {chosen?.is_legacy && (
            <p className="text-sm text-stone-600">
              Current crate: {chosen.name} · Needs exact crate setup
            </p>
          )}
          <div>
            <label htmlFor="crate_type_id">Crate type</label>
            <select
              id="crate_type_id"
              className={selectStyle}
              value={chosen?.is_legacy ? "" : selected}
              required={!selected}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "crate-type-error" : undefined}
              onChange={(e) => onChange(e.target.value)}
            >
              <option value="">Choose existing crate</option>
              {exactOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {productCrateLabel(c)}
                </option>
              ))}
            </select>
            {!exactOptions.length && (
              <p className="mt-2 text-sm text-stone-600">
                No crate types set up yet. Add one below.
              </p>
            )}
          </div>
          <button
            type="button"
            className="secondary w-full"
            onClick={() => {
              setMode("create");
              onBusy(true);
              setMessage("");
            }}
          >
            + Add new crate type
          </button>
        </>
      ) : (
        <div className="space-y-4">
          <h3 className="font-semibold">Add new crate type</h3>
          <div>
            <label htmlFor="crate-family">Family</label>
            <input
              id="crate-family"
              list="crate-families"
              maxLength={80}
              value={family}
              onChange={(e) => setFamily(e.target.value)}
            />
            <datalist id="crate-families">
              {Array.from(
                new Set(
                  options
                    .map((c) => c.empty_family)
                    .filter((f): f is string => Boolean(f)),
                ),
              ).map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="crate-pockets">Pocket count</label>
            <select
              id="crate-pockets"
              className={selectStyle}
              value={pocket}
              onChange={(e) => setPocket(e.target.value)}
            >
              <option value="">Choose pocket count</option>
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
              <label htmlFor="other-pockets">Other pocket count</label>
              <input
                id="other-pockets"
                inputMode="numeric"
                maxLength={10}
                value={other}
                onChange={(e) => setOther(e.target.value)}
              />
            </div>
          )}
          <div>
            <label htmlFor="crate-variant">Variant / form</label>
            <input
              id="crate-variant"
              maxLength={120}
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="crate-name">Distinguishing name (optional)</label>
            <input
              id="crate-name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {message && (
            <p role="alert" className="text-red-800">
              {message}
            </p>
          )}
          <button
            type="button"
            className="primary w-full"
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await createCrateType(submissionId, {
                    name,
                    empty_family: family,
                    pocket_count: pockets,
                    variant,
                  });
                  if (result.crate) {
                    const created = result.crate;
                    setOptions((current) => [
                      ...current.filter((c) => c.id !== created.id),
                      created,
                    ]);
                    onChange(created.id);
                    chooseExisting();
                    setFamily("");
                    setPocket("");
                    setOther("");
                    setName("");
                    setVariant("");
                    setSubmissionId(crypto.randomUUID());
                  } else
                    setMessage(
                      result.message ?? "Could not save the crate type.",
                    );
                } catch {
                  setMessage("Could not connect. Please try again.");
                }
              })
            }
          >
            {pending ? "Saving…" : "Add and select crate"}
          </button>
          <button
            type="button"
            className="secondary w-full"
            onClick={chooseExisting}
          >
            Choose existing crate
          </button>
        </div>
      )}
      {error && (
        <p id="crate-type-error" role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </fieldset>
  );
}
