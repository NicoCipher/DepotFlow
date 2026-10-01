"use client";
import { CrateTypeForm } from "@/components/crate-type-form";
import { CrateTypeSelector } from "@/components/crate-type-selector";
import {
  crateFitsProduct,
  crateNeedsSetup,
  type CrateType,
  type CrateChoice,
} from "@/domain/crate-types";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { addProduct, editProduct } from "@/app/(shop)/products/actions";
import {
  validateProduct,
  type ProductValues,
  type ProductErrors,
} from "@/domain/products";

export function ProductForm({
  id,
  initialValues,
  editing = false,
  crateTypes,
  catalogueProductId,
}: {
  id: string;
  initialValues: ProductValues;
  editing?: boolean;
  crateTypes: CrateType[];
  catalogueProductId?: string;
}) {
  const [availableCrates, setAvailableCrates] = useState<CrateChoice[]>(crateTypes);
  const [values, setValues] = useState(initialValues);
  const [crateDraft, setCrateDraft] = useState<{ id: string; bottles: string } | null>(null);
  const [crateMessage, setCrateMessage] = useState("");
  function chooseCrate(crate: CrateChoice) {
    setValues((current) => ({
      ...current,
      crate_type_id: crate.id,
      bottles_per_crate: crate.pocket_count === null ? current.bottles_per_crate : String(crate.pocket_count),
    }));
    setClientErrors((current) => ({ ...current, crate_type_id: undefined, bottles_per_crate: undefined }));
  }
  const optionalDetails = useRef<HTMLDetailsElement>(null);
  const optionalFields = ["size", "image_url", "half_crate_price", "quarter_crate_price", "bottle_price"] as const;
  const [optionalOpen, setOptionalOpen] = useState(() =>
    optionalFields.some((key) => Boolean(initialValues[key])),
  );
  const [clientErrors, setClientErrors] = useState<ProductErrors>({});
  const [state, action, pending] = useActionState(
    (editing ? editProduct : addProduct).bind(null, id),
    { values: initialValues, errors: {} },
  );
  const errors = { ...state.errors, ...clientErrors };
  function change(field: keyof ProductValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setClientErrors((current) => ({ ...current, [field]: undefined }));
  }
  function field(
    name: keyof ProductValues,
    label: string,
    maxLength: number,
    required = false,
    numeric = false,
  ) {
    return (
      <div key={name}>
        <label htmlFor={name}>{label}</label>
        <input
          id={name}
          name={name}
          type={name === "image_url" ? "url" : "text"}
          inputMode={numeric ? "numeric" : undefined}
          pattern={numeric ? "[0-9]+" : undefined}
          maxLength={maxLength}
          required={required}
          value={values[name]}
          readOnly={pending}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `${name}-error` : undefined}
          onChange={(e) => change(name, e.target.value)}
        />
        {errors[name] && (
          <p
            id={`${name}-error`}
            role="alert"
            className="mt-2 text-sm text-red-800"
          >
            {errors[name]}
          </p>
        )}
      </div>
    );
  }
  return (
    <>
    {crateDraft && (
      <section className="mt-5">
        <h2 className="text-xl font-semibold">Add the crate for {values.name || "this drink"}</h2>
        <p className="mt-2 text-stone-600">Your drink details are kept here. Save this crate to continue.</p>
        <CrateTypeForm id={crateDraft.id}
          initial={{ name: "", empty_family: "", pocket_count: crateDraft.bottles, variant: "" }}
          onCancel={() => {
            setCrateDraft(null);
            requestAnimationFrame(() => document.getElementById("crate_type_id")?.focus());
          }}
          onSaved={(crate) => {
            setAvailableCrates((current) => [...current.filter((item) => item.id !== crate.id), crate]);
            chooseCrate(crate);
            setCrateMessage(`${crate.name} saved and selected.`);
            setCrateDraft(null);
            requestAnimationFrame(() => document.getElementById("crate_type_id")?.focus());
          }} />
      </section>
    )}
    {!crateDraft && <form
      action={action}
      className="mt-5 space-y-7"
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        const checked = validateProduct(values);
        const selectedCrate = availableCrates.find(
          (crate) => crate.id === values.crate_type_id,
        );
        if (selectedCrate && crateNeedsSetup(selectedCrate)) {
          checked.errors.crate_type_id =
            "This crate record is incomplete. Choose or add the physical crate this drink really uses.";
          checked.valid = false;
        } else if (
          selectedCrate &&
          !crateFitsProduct(
            selectedCrate.pocket_count,
            Number(values.bottles_per_crate),
          )
        ) {
          checked.errors.crate_type_id =
            "The crate bottle spaces must match the bottles per crate for this drink.";
          checked.valid = false;
        }
        setClientErrors(checked.errors);
        if (!checked.valid) {
          event.preventDefault();
          const firstError = Object.keys(checked.errors)[0];
          if (optionalFields.some((key) => key === firstError) && optionalDetails.current) {
            optionalDetails.current.open = true;
            setOptionalOpen(true);
          }
          document.getElementById(firstError === "bottles_per_crate" ? "crate_type_id" : firstError)?.focus();
        }
      }}
    >
      {catalogueProductId && <input type="hidden" name="catalogue_product_id" value={catalogueProductId} />}
      <p className="text-sm text-stone-600">Enter the price, choose the crate, then save the drink.</p>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <fieldset className="space-y-5">
        <legend className="mb-4 text-lg font-semibold">1. Drink name</legend>
        {field("name", "Name", 120, true)}

      </fieldset>
      <fieldset className="space-y-5 border-t border-stone-300 pt-5">
        <legend className="text-lg font-semibold">2. Selling price</legend>
        <p className="text-sm text-stone-600">What you charge for one full crate. Use ₦50 steps.</p>
        {field("full_crate_price", "Full crate price (₦)", 10, true, true)}
      </fieldset>
      <fieldset className="space-y-5 border-t border-stone-300 pt-5">
        <legend className="text-lg font-semibold">3. Crate and bottles</legend>
        <p className="text-sm text-stone-600">Use the actual crate and bottles for this drink. These details help track empties.</p>
        <CrateTypeSelector
          types={availableCrates}
          onRefresh={setAvailableCrates}
          selected={values.crate_type_id}
          onChange={(id) => {
            setCrateMessage("");
            const crate = availableCrates.find((item) => item.id === id);
            if (crate) chooseCrate(crate);
            else change("crate_type_id", id);
          }}
          onAdd={() => setCrateDraft({ id: crypto.randomUUID(), bottles: values.bottles_per_crate })}
          disabled={pending}
          error={errors.crate_type_id}
        />
        {crateMessage && <p role="status" className="text-sm text-emerald-900">{crateMessage}</p>}
        <input type="hidden" name="bottles_per_crate" value={values.bottles_per_crate} />
        {values.crate_type_id && values.bottles_per_crate && <p className="text-sm font-semibold">{values.bottles_per_crate} bottles in one crate</p>}
        {errors.bottles_per_crate && <p role="alert" className="text-sm text-red-800">Choose a crate with a valid bottle count, or add the correct crate.</p>}
        <fieldset>
          <legend className="mb-3 font-semibold">Do customers bring the empty bottles back?</legend>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: "true", label: "Yes", detail: "We collect the empties" },
              { value: "false", label: "No", detail: "Cans or non-returnable bottles" },
            ].map((choice) => (
              <label key={choice.value} className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border p-3 ${values.bottles_returnable === choice.value ? "border-emerald-800 bg-emerald-50" : "border-stone-400 bg-white"}`}>
                <input type="radio" name="bottles_returnable" value={choice.value} required disabled={pending}
                  id={choice.value === "true" ? "bottles_returnable" : "bottles-not-returnable"}
                  checked={values.bottles_returnable === choice.value}
                  onChange={(event) => change("bottles_returnable", event.target.value)}
                  aria-describedby={errors.bottles_returnable ? "returnable-error" : undefined}
                  className="mt-1 h-5 min-h-0 w-5 shrink-0 accent-emerald-800" />
                <span>{choice.label}<span className="mt-1 block text-sm font-normal text-stone-600">{choice.detail}</span></span>
              </label>
            ))}
          </div>
          {errors.bottles_returnable && <p id="returnable-error" role="alert" className="mt-2 text-sm text-red-800">{errors.bottles_returnable}</p>}
        </fieldset>
        {values.bottles_returnable === "true" ? (
          <div>
            {field("bottle_type", "What do you call the empty bottle?", 120, true)}
            <p className="mt-2 text-sm text-stone-600">Use the name you use in the shop, for example “Guinness big”.</p>
          </div>
        ) : <input type="hidden" name="bottle_type" value={values.bottle_type} />}
      </fieldset>
      <details className="border-t border-stone-300 pt-5"
        ref={optionalDetails}
        open={optionalOpen || optionalFields.some((key) => Boolean(errors[key]))}
        onToggle={(event) => setOptionalOpen(event.currentTarget.open)}>
        <summary className="min-h-12 cursor-pointer py-3 font-semibold">Optional details and other selling prices</summary>
        <div className="mt-4 space-y-5">
          <p className="text-sm text-stone-600">Leave half and quarter prices blank to calculate them from the full crate price. Bottle price is separate.</p>
          {field("size", "Size (optional)", 80)}
          {field("image_url", "Image URL (optional)", 2048)}
        {field(
          "half_crate_price",
          "Half-crate selling price (₦, optional)",
          10,
          false,
          true,
        )}
        {field(
          "quarter_crate_price",
          "Quarter-crate selling price (₦, optional)",
          10,
          false,
          true,
        )}
        {field("bottle_price", "Bottle price (₦, optional)", 10, false, true)}
        </div>
      </details>
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Add drink to my shop"}
      </button>
      <Link
        className="quiet-link block text-center"
        href={editing ? `/products/${id}` : "/products"}
      >
        Cancel
      </Link>
    </form>}
    </>
  );
}
