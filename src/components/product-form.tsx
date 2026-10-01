"use client";
import { CrateTypeSelector } from "@/components/crate-type-selector";
import {
  crateFitsProduct,
  crateNeedsSetup,
  type CrateType,
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
  const [availableCrates, setAvailableCrates] = useState(crateTypes);
  const [values, setValues] = useState(initialValues);
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
    <form
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
          document.getElementById(firstError)?.focus();
        }
      }}
    >
      {catalogueProductId && <input type="hidden" name="catalogue_product_id" value={catalogueProductId} />}
      <p className="text-sm text-stone-600">Check the drink and selling price, then complete its crate and bottle details.</p>
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
        {field("bottles_per_crate", "How many bottles in one crate?", 10, true, true)}
        <CrateTypeSelector
          types={availableCrates}
          onRefresh={setAvailableCrates}
          selected={values.crate_type_id}
          onChange={(id) => change("crate_type_id", id)}
          disabled={pending}
          error={errors.crate_type_id}
        />
        <div>
          <label htmlFor="bottles_returnable">
            Are the bottles returnable?
          </label>
          <select
            id="bottles_returnable"
            name="bottles_returnable"
            required
            disabled={pending}
            value={values.bottles_returnable}
            className="min-h-12 w-full rounded-md border border-stone-400 bg-white p-3"
            aria-invalid={Boolean(errors.bottles_returnable)}
            aria-describedby={
              errors.bottles_returnable ? "returnable-error" : undefined
            }
            onChange={(e) => change("bottles_returnable", e.target.value)}
          >
            <option value="">Choose Yes or No</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
          {errors.bottles_returnable && (
            <p
              id="returnable-error"
              role="alert"
              className="mt-2 text-sm text-red-800"
            >
              {errors.bottles_returnable}
            </p>
          )}
        </div>
        <p className="text-sm text-stone-600">Returnable means customers bring the empty bottles back. Choose No for cans or non-returnable bottles.</p>
        {field(
          "bottle_type",
          values.bottles_returnable === "true"
            ? "Which empty bottle belongs to this drink?"
            : "Empty bottle name (optional)",
          120,
          values.bottles_returnable === "true",
        )}
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
    </form>
  );
}
