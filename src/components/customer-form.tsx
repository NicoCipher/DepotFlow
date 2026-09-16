"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  addCustomer,
  addCustomerForSale,
  editCustomer,
} from "@/app/(shop)/customers/actions";
import {
  validateCustomer,
  type CustomerValues,
  type CustomerErrors,
  type CustomerFormState,
} from "@/domain/customers";

export function CustomerForm({
  id,
  initialValues,
  editing = false,
  onCreated,
  onCancel,
}: {
  id: string;
  initialValues: CustomerValues;
  editing?: boolean;
  onCreated?: (id: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [clientErrors, setClientErrors] = useState<CustomerErrors>({});
  const [state, action, pending] = useActionState(
    async (
      previous: CustomerFormState,
      formData: FormData,
    ): Promise<CustomerFormState> => {
      const result = previous.createdId
        ? previous
        : await (
            editing
              ? editCustomer
              : onCreated
                ? addCustomerForSale
                : addCustomer
          )(id, previous, formData);
      if (result.createdId && onCreated) {
        try {
          await onCreated(result.createdId);
        } catch {
          return {
            ...result,
            message:
              "Customer saved. Could not return to the sale. Try Continue to sale again.",
          };
        }
      }
      return result;
    },
    { values: initialValues, errors: {} } as CustomerFormState,
  );
  const errors = { ...state.errors, ...clientErrors };
  return (
    <form
      action={action}
      className="mt-7 space-y-5"
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        const checked = validateCustomer(values);
        setClientErrors(checked.errors);
        if (!checked.valid) event.preventDefault();
      }}
    >
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      {(
        [
          ["name", "Name", 120, true, "name"],
          ["phone", "Phone", 40, true, "tel"],
          [
            "business_name",
            "Business name (optional)",
            160,
            false,
            "organization",
          ],
          ["address", "Address (optional)", 500, false, "street-address"],
        ] as const
      ).map(([field, label, maxLength, required, autoComplete]) => (
        <div key={field}>
          <label htmlFor={field}>{label}</label>
          {field === "address" ? (
            <textarea
              id={field}
              name={field}
              rows={3}
              maxLength={maxLength}
              autoComplete={autoComplete}
              value={values[field]}
              readOnly={pending || Boolean(state.createdId)}
              aria-invalid={Boolean(errors[field])}
              aria-describedby={errors[field] ? `${field}-error` : undefined}
              onChange={(e) =>
                setValues({ ...values, [field]: e.target.value })
              }
            />
          ) : (
            <input
              id={field}
              name={field}
              type={field === "phone" ? "tel" : "text"}
              autoComplete={autoComplete}
              required={required}
              maxLength={maxLength}
              value={values[field]}
              readOnly={pending || Boolean(state.createdId)}
              aria-invalid={Boolean(errors[field])}
              aria-describedby={errors[field] ? `${field}-error` : undefined}
              onChange={(e) => {
                setValues({ ...values, [field]: e.target.value });
                setClientErrors({ ...clientErrors, [field]: undefined });
              }}
            />
          )}
          {errors[field] && (
            <p
              id={`${field}-error`}
              role="alert"
              className="mt-2 text-sm text-red-800"
            >
              {errors[field]}
            </p>
          )}
        </div>
      ))}
      <button className="primary w-full" disabled={pending}>
        {pending
          ? "Saving…"
          : state.createdId
            ? "Continue to sale"
            : editing
              ? "Save changes"
              : "Save Customer"}
      </button>
      {onCancel ? (
        !state.createdId && (
          <button
            type="button"
            className="quiet-link block w-full text-center"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
        )
      ) : (
        <Link
          className="quiet-link block text-center"
          href={editing ? `/customers/${id}` : "/customers"}
        >
          Cancel
        </Link>
      )}
    </form>
  );
}
