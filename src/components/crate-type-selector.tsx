"use client";
import { useState, useTransition } from "react";
import { createCrateType } from "@/app/(shop)/products/crate-actions";
import { crateLabel, crateMatches, type CrateType } from "@/domain/crate-types";
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
  const [family, setFamily] = useState("");
  const [pocket, setPocket] = useState("");
  const [other, setOther] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [variant, setVariant] = useState("");
  const [submissionId, setSubmissionId] = useState(requestId);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const locked = disabled || pending;
  const pockets = pocket === "other" ? other : pocket;
  const chosen = options.find((c) => c.id === selected);
  return (
    <fieldset className="space-y-4" disabled={locked}>
      <legend className="text-lg font-semibold">Physical crate</legend>
      <p className="text-sm text-stone-600">
        Family and pockets describe a crate. Choose its exact identity below.
      </p>
      <div>
        <label htmlFor="crate-family">
          Empty family {creating ? "" : "(filter)"}
        </label>
        <input
          id="crate-family"
          list="crate-families"
          value={family}
          maxLength={80}
          onChange={(e) => setFamily(e.target.value)}
        />
        <datalist id="crate-families">
          {Array.from(
            new Set(
              options
                .map((c) => c.empty_family)
                .filter((f): f is string => f !== null),
            ),
          ).map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor="crate-pockets">
          Pocket count {creating ? "" : "(filter)"}
        </label>
        <select
          id="crate-pockets"
          className={selectStyle}
          value={pocket}
          onChange={(e) => setPocket(e.target.value)}
        >
          <option value="">
            {creating ? "Choose pockets" : "All pocket counts"}
          </option>
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
            value={other}
            maxLength={10}
            onChange={(e) => setOther(e.target.value)}
          />
        </div>
      )}
      <div>
        <label htmlFor="crate_type_id">Exact crate type</label>
        <select
          id="crate_type_id"
          name="crate_type_id"
          className={selectStyle}
          value={selected}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "crate-type-error" : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose an exact crate</option>
          {options
            .filter(
              (c) => c.id === selected || crateMatches(c, family, pockets),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {crateLabel(c)}
              </option>
            ))}
        </select>
        {error && (
          <p id="crate-type-error" role="alert" className="text-red-800">
            {error}
          </p>
        )}
      </div>
      {chosen && (
        <p className="break-words font-semibold">
          Selected: {crateLabel(chosen)}
        </p>
      )}
      {chosen?.is_legacy && (
        <p className="text-sm text-stone-600">
          Changing this product’s crate does not move any legacy empty-crate
          balance or history.
        </p>
      )}
      {!creating ? (
        <button
          type="button"
          className="secondary w-full"
          onClick={() => {
            setCreating(true);
            onBusy(true);
            setMessage("");
          }}
        >
          Create a new exact crate type
        </button>
      ) : (
        <div className="space-y-4 border-t border-stone-300 pt-4">
          <p>
            New identity. Matching family or pockets will not combine it with
            another crate. Create or cancel this crate before saving the
            product.
          </p>
          <div>
            <label htmlFor="crate-name">Exact crate name</label>
            <input
              id="crate-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="crate-variant">Variant / form (optional)</label>
            <input
              id="crate-variant"
              value={variant}
              maxLength={120}
              onChange={(e) => setVariant(e.target.value)}
            />
          </div>
          {message && (
            <p role="alert" className="text-red-800">
              {message}
            </p>
          )}
          <button
            type="button"
            className="secondary w-full"
            onClick={() => {
              onBusy(true);
              startTransition(async () => {
                try {
                  const result = await createCrateType(submissionId, {
                    name,
                    empty_family: family,
                    pocket_count: pockets,
                    variant,
                  });
                  if (result.crate) {
                    setOptions((current) => [
                      ...current.filter((c) => c.id !== result.crate!.id),
                      result.crate!,
                    ]);
                    onChange(result.crate.id);
                    setCreating(false);
                    onBusy(false);
                    setName("");
                    setVariant("");
                    setSubmissionId(crypto.randomUUID());
                  } else setMessage(result.message ?? "Could not save.");
                } catch {
                  setMessage("Could not connect. You can safely retry.");
                }
              });
            }}
          >
            {pending ? "Saving crate…" : "Create and select this crate"}
          </button>
          <button
            type="button"
            className="quiet-link"
            onClick={() => {
              setCreating(false);
              onBusy(false);
            }}
          >
            Cancel new crate
          </button>
        </div>
      )}
    </fieldset>
  );
}
