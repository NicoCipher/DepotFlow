"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { recordOpeningBalances } from "@/app/(shop)/customers/[id]/opening-balances/actions";
import {
  validateOpeningBalances,
  type OpeningInput,
  type OpeningState,
} from "@/domain/opening-balances";
import { formatNaira } from "@/domain/products";

type Choice = { id: string; name: string };
export function OpeningBalancesForm({
  customerId,
  requestId,
  today,
  crates,
  bottles,
}: {
  customerId: string;
  requestId: string;
  today: string;
  crates: Choice[];
  bottles: Choice[];
}) {
  const [submissionId] = useState(requestId);
  const [values, setValues] = useState<OpeningInput>({
    amount: "0",
    businessDate: today,
    note: "",
    crates: [],
    bottles: [],
  });
  const [review, setReview] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<
    string,
    string
  > | null>(null);
  const [state, action, pending] = useActionState(
    recordOpeningBalances.bind(null, customerId, submissionId),
    {} as OpeningState,
  );
  const locked = pending || Boolean(state.retryable);
  const errors = clientErrors ?? state.errors ?? {};
  function check() {
    const checked = validateOpeningBalances(values, today);
    setClientErrors(checked.errors);
    if (checked.values) {
      setReview(true);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }
  function error(key: string) {
    return errors[key] ? (
      <p
        id={`opening-${key}-error`}
        role="alert"
        className="mt-2 text-sm text-red-800"
      >
        {errors[key]}
      </p>
    ) : null;
  }
  return (
    <form
      action={action}
      className="mt-6 space-y-6"
      onSubmit={(event) => {
        if (!review) {
          event.preventDefault();
          check();
        }
      }}
    >
      <input type="hidden" name="balances" value={JSON.stringify(values)} />
      {review ? (
        <section aria-labelledby="opening-review-heading" className="space-y-4">
          <h2 id="opening-review-heading" className="text-xl font-semibold">
            Check the old balances
          </h2>
          <dl className="review-list">
            <div>
              <dt>Balance date</dt>
              <dd>{values.businessDate}</dd>
            </div>
            <div>
              <dt>Old money owed to add</dt>
              <dd className="font-semibold">
                {formatNaira(Number(values.amount))}
              </dd>
            </div>
          </dl>
          {(["crates", "bottles"] as const).map((kind) =>
            values[kind].length > 0 ? (
              <div
                key={kind}
                className="rounded-xl border border-stone-200 bg-white p-4"
              >
                <h3 className="font-semibold">Empty {kind} to add</h3>
                <ul className="mt-2 space-y-2">
                  {values[kind].map((row) => (
                    <li
                      key={row.type}
                      className="flex justify-between gap-4 text-sm"
                    >
                      <span>
                        {(kind === "crates" ? crates : bottles).find(
                          (choice) => choice.id === row.type,
                        )?.name ?? row.type}
                      </span>
                      <strong>{row.quantity}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {values.note && (
            <p className="break-words text-sm text-stone-600">
              Note: {values.note}
            </p>
          )}
          <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            These balances will be added to what this customer already owes in
            DepotFlow. Record only debt from before you started using the app.
            Opening balances are recorded once per customer.
          </p>
        </section>
      ) : (
        <fieldset disabled={locked} className="space-y-6">
          <div>
            <label htmlFor="opening-date">Balance date</label>
            <input
              id="opening-date"
              type="date"
              min="0001-01-01"
              max={today}
              required
              value={values.businessDate}
              aria-invalid={Boolean(errors.businessDate)}
              aria-describedby={
                errors.businessDate ? "opening-businessDate-error" : undefined
              }
              onChange={(e) =>
                setValues({ ...values, businessDate: e.target.value })
              }
            />
            {error("businessDate")}
            <p className="mt-2 text-xs text-stone-500">
              The date these old balances were brought into DepotFlow.
            </p>
          </div>
          <div>
            <label htmlFor="opening-amount">Money already owed (₦)</label>
            <input
              id="opening-amount"
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={values.amount}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={
                errors.amount ? "opening-amount-error" : undefined
              }
              onChange={(e) => setValues({ ...values, amount: e.target.value })}
            />
            {error("amount")}
            <p className="mt-2 text-xs text-stone-500">
              Use 0 if they only owe empties.
            </p>
          </div>
          <section className="space-y-5 border-y border-stone-200 py-5">
            <div>
              <h2 className="text-lg font-semibold">Empties already owed</h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Count the crates and bottles separately. For a complete crate
                owed, enter 1 crate and its number of bottles.
              </p>
            </div>
            {(["crates", "bottles"] as const).map((kind) => {
              const choices = kind === "crates" ? crates : bottles;
              return (
                <section key={kind} aria-labelledby={`opening-${kind}-heading`}>
                  <h3
                    id={`opening-${kind}-heading`}
                    className="mb-3 font-semibold"
                  >
                    Empty {kind}
                  </h3>
                  {values[kind].map((row, index) => (
                    <div
                      key={index}
                      className="mb-3 space-y-3 rounded-xl border border-stone-200 bg-white p-4"
                    >
                      <div>
                        <label
                          className="text-sm"
                          htmlFor={`opening-${kind}-${index}-type`}
                        >
                          {kind === "crates" ? "Crate type" : "Bottle type"}
                        </label>
                        <select
                          id={`opening-${kind}-${index}-type`}
                          value={row.type}
                          aria-invalid={Boolean(
                            errors[`${kind}.${index}.type`],
                          )}
                          aria-describedby={
                            errors[`${kind}.${index}.type`]
                              ? `opening-${kind}.${index}.type-error`
                              : undefined
                          }
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [kind]: values[kind].map((r, i) =>
                                i === index
                                  ? { ...r, type: e.target.value }
                                  : r,
                              ),
                            })
                          }
                        >
                          <option value="">Choose type</option>
                          {choices.map((choice) => (
                            <option key={choice.id} value={choice.id}>
                              {choice.name}
                            </option>
                          ))}
                        </select>
                        {error(`${kind}.${index}.type`)}
                      </div>
                      <div>
                        <label
                          className="text-sm"
                          htmlFor={`opening-${kind}-${index}-quantity`}
                        >
                          Number of {kind}
                        </label>
                        <input
                          id={`opening-${kind}-${index}-quantity`}
                          inputMode="numeric"
                          pattern="[0-9]+"
                          value={row.quantity}
                          aria-invalid={Boolean(
                            errors[`${kind}.${index}.quantity`],
                          )}
                          aria-describedby={
                            errors[`${kind}.${index}.quantity`]
                              ? `opening-${kind}.${index}.quantity-error`
                              : undefined
                          }
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [kind]: values[kind].map((r, i) =>
                                i === index
                                  ? { ...r, quantity: e.target.value }
                                  : r,
                              ),
                            })
                          }
                        />
                        {error(`${kind}.${index}.quantity`)}
                      </div>
                      <button
                        type="button"
                        className="min-h-11 text-sm font-medium text-red-800 underline underline-offset-4"
                        aria-label={`Remove ${kind} row ${index + 1}`}
                        onClick={() =>
                          setValues({
                            ...values,
                            [kind]: values[kind].filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {error(kind)}
                  {choices.length ? (
                    <button
                      type="button"
                      className="secondary w-full text-sm"
                      disabled={values[kind].length >= 100}
                      onClick={() =>
                        setValues({
                          ...values,
                          [kind]: [...values[kind], { type: "", quantity: "" }],
                        })
                      }
                    >
                      + Add {kind === "crates" ? "crate" : "bottle"} type
                    </button>
                  ) : (
                    <p className="text-sm text-stone-600">
                      No{" "}
                      {kind === "crates"
                        ? "exact crate types"
                        : "returnable bottle types"}{" "}
                      available. Set them up in{" "}
                      {kind === "crates" ? "Crate Types" : "Products"} first.
                    </p>
                  )}
                </section>
              );
            })}
          </section>
          <div>
            <label htmlFor="opening-note">
              Note{" "}
              <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <textarea
              id="opening-note"
              maxLength={300}
              rows={2}
              placeholder="For example: balance from the shop notebook"
              value={values.note}
              onChange={(e) => setValues({ ...values, note: e.target.value })}
            />
            {error("note")}
          </div>
        </fieldset>
      )}
      {state.message && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-900"
        >
          {state.message}
        </p>
      )}
      {state.message?.startsWith("Your session") && (
        <Link className="quiet-link" href="/sign-in" target="_blank">
          Sign in in a new tab
        </Link>
      )}
      {review && !locked && (
        <button
          type="button"
          className="secondary w-full"
          onClick={() => {
            setReview(false);
            setClientErrors(null);
          }}
        >
          Edit entries
        </button>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending
          ? "Saving…"
          : state.retryable
            ? "Retry same opening balances"
            : review
              ? "Save Opening Balances"
              : "Review Opening Balances"}
      </button>
    </form>
  );
}
