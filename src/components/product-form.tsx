"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
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
}: {
  id: string;
  initialValues: ProductValues;
  editing?: boolean;
}) {
  const [values, setValues] = useState(initialValues);
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
      className="mt-7 space-y-8"
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        const checked = validateProduct(values);
        setClientErrors(checked.errors);
        if (!checked.valid) {
          event.preventDefault();
          document.getElementById(Object.keys(checked.errors)[0])?.focus();
        }
      }}
    >
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <fieldset className="space-y-5">
        <legend className="mb-4 text-lg font-semibold">Drink details</legend>
        {field("name", "Name", 120, true)}
        {field("size", "Size (optional)", 80)}
        {field("bottles_per_crate", "Bottles per crate", 10, true, true)}
        {field("image_url", "Image URL (optional)", 2048)}
      </fieldset>
      <fieldset className="space-y-5 border-t border-stone-300 pt-5">
        <legend className="text-lg font-semibold">Prices</legend>
        <p className="text-sm text-stone-600">
          Enter whole naira in ₦50 steps. Leave prices you do not use blank.
        </p>
        {field("full_crate_price", "Full crate price (₦)", 10, true, true)}
        {field(
          "half_crate_price",
          "Half-crate price (₦, optional)",
          10,
          false,
          true,
        )}
        {field(
          "quarter_crate_price",
          "Quarter-crate price (₦, optional)",
          10,
          false,
          true,
        )}
        {field("bottle_price", "Bottle price (₦, optional)", 10, false, true)}
      </fieldset>
      <fieldset className="space-y-5 border-t border-stone-300 pt-5">
        <legend className="text-lg font-semibold">Empty containers</legend>
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
        {field("crate_type", "Empty crate type", 120, true)}
        {field(
          "bottle_type",
          values.bottles_returnable === "true"
            ? "Empty bottle type"
            : "Empty bottle type (optional)",
          120,
          values.bottles_returnable === "true",
        )}
        {field("empty_family", "Empty family (optional)", 80)}
      </fieldset>
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Save Product"}
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
