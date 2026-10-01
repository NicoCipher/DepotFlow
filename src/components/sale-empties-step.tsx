"use client";

import { useState } from "react";
import Link from "next/link";
import {
  crateReturnIssues,
  depositSetupIssues,
  matchSaleEmpties,
  hasUnmatchedSaleEmpties,
  missingEmptiesMessage,
  type EmptiesMatchResult,
} from "@/domain/sale-empties";
import type { SaleCatalog, SaleDraft } from "@/domain/sale-builder";
import { wholeNumberInputMessage } from "@/domain/sale-input";

type Props = {
  draft: SaleDraft;
  catalog: SaleCatalog;
  update: (patch: Partial<SaleDraft>) => void;
  onBack: () => void;
};

function add(map: Record<string, string>, key: string, amount: number) {
  if (!amount) return;
  map[key] = String(Number(map[key] ?? "0") + amount);
}

export function SaleEmptiesStep({ draft, catalog, update, onBack }: Props) {
  const state = draft.emptiesV2;
  const [choice, setChoice] = useState({
    productId: "",
    kind: "crate" as "crate" | "bottle",
    returnedType: "",
    quantity: "1",
    decision: "hold" as "accept" | "hold",
  });
  const [choiceError, setChoiceError] = useState("");
  const [extraCrates, setExtraCrates] = useState<string[]>([]);
  const [extraBottles, setExtraBottles] = useState<string[]>([]);
  const customer = catalog.customers.find(
    (item) => item.id === draft.customerId,
  );
  const crateName = new Map(
    catalog.crateTypes.map((crate) => [crate.id, crate.name]),
  );
  const productName = new Map(
    catalog.products.map((product) => [
      product.id,
      [product.name, product.size].filter(Boolean).join(" "),
    ]),
  );
  const bottleTypes = Array.from(
    new Set(
      catalog.products
        .filter((product) => product.bottles_returnable && product.bottle_type)
        .map((product) => product.bottle_type as string),
    ),
  ).sort((a, b) => a.localeCompare(b));
  let expected: EmptiesMatchResult | null = null;
  try {
    expected = matchSaleEmpties(
      {
        ...draft,
        emptiesV2: { ...state, mode: "exact", decisions: [] },
      },
      catalog,
    );
  } catch {
    // Validation below explains invalid sale quantities or crates taken.
  }
  const expectedCrateIds = new Set(
    expected?.lines
      .filter((line) => line.cratesOut > 0)
      .map((line) => line.crateTypeId),
  );
  const expectedBottleTypes = new Set(
    expected?.lines
      .filter((line) => line.bottlesOut > 0 && line.bottleType)
      .map((line) => line.bottleType as string),
  );
  const visibleCrateIds = new Set([
    ...expectedCrateIds,
    ...extraCrates,
    ...Object.entries(state.returnedCrates)
      .filter(([, value]) => value !== "0")
      .map(([id]) => id),
  ]);
  const visibleBottleTypes = new Set([
    ...expectedBottleTypes,
    ...extraBottles,
    ...Object.entries(state.returnedBottles)
      .filter(([, value]) => value !== "0")
      .map(([type]) => type),
  ]);
  const otherCrates = catalog.crateTypes.filter(
    (crate) => !visibleCrateIds.has(crate.id),
  );
  const otherBottles = bottleTypes.filter(
    (type) => !visibleBottleTypes.has(type),
  );

  const cratesTakenErrors: Record<string, string> = {};
  for (const line of draft.lines.filter((item) => item.quantity.crates > 0)) {
    const raw = state.cratesTaken[line.productId];
    if (raw === undefined) continue;
    const name = productName.get(line.productId) ?? "Drink";
    const message = wholeNumberInputMessage(
      raw,
      `${name} physical crates taken`,
      {
        max: line.quantity.crates,
        maxMessage:
          line.quantity.crates === 1
            ? `This sale has only 1 whole crate of ${name}.`
            : `This sale has only ${line.quantity.crates} whole crates of ${name}.`,
      },
    );
    if (message) cratesTakenErrors[line.productId] = message;
  }

  const returnedCrateErrors: Record<string, string> = {};
  const returnedBottleErrors: Record<string, string> = {};
  if (state.mode === "actual") {
    for (const crate of catalog.crateTypes) {
      const raw = state.returnedCrates[crate.id];
      if (raw === undefined) continue;
      const message = wholeNumberInputMessage(
        raw,
        `${crate.name} crates returned`,
      );
      if (message) returnedCrateErrors[crate.id] = message;
    }
    for (const bottleType of bottleTypes) {
      const raw = state.returnedBottles[bottleType];
      if (raw === undefined) continue;
      const message = wholeNumberInputMessage(
        raw,
        `${bottleType} bottles returned`,
      );
      if (message) returnedBottleErrors[bottleType] = message;
    }
  }
  const hasFieldErrors =
    Object.keys(cratesTakenErrors).length > 0 ||
    Object.keys(returnedCrateErrors).length > 0 ||
    Object.keys(returnedBottleErrors).length > 0;

  let result: EmptiesMatchResult | null = null;
  let error = "";
  try {
    if (!hasFieldErrors) result = matchSaleEmpties(draft, catalog);
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Check the returned empties.";
  }

  function useActualReturns() {
    try {
      const exact = expected;
      if (!exact) throw new Error("Check the empties first.");
      const returnedCrates: Record<string, string> = {};
      const returnedBottles: Record<string, string> = {};
      for (const line of exact.lines) {
        add(returnedCrates, line.crateTypeId, line.cratesOut);
        if (line.bottleType)
          add(returnedBottles, line.bottleType, line.bottlesOut);
      }
      update({
        emptiesV2: {
          ...state,
          mode: "actual",
          decisions: [],
          returnedCrates,
          returnedBottles,
        },
      });
    } catch {
      update({ emptiesV2: { ...state, mode: "actual" } });
    }
  }

  const shortages =
    result?.lines.filter((line) => line.cratesOwed || line.bottlesOwed) ?? [];
  const crateIssues = result ? crateReturnIssues(result, catalog) : [];
  const depositBlocked =
    Boolean(customer?.empties_deposit_required) && shortages.length > 0;
  const missingDepositSetup =
    depositBlocked && result ? depositSetupIssues(result, catalog) : [];

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold">Empty crates and bottles</h2>
        <p className="mt-1 text-stone-600">
          Check what this customer brought back for these drinks.
        </p>
      </div>
      <p className="font-semibold">Did they bring back all the empties?</p>

      <div
        role="group"
        aria-label="Empties returned"
        className="grid grid-cols-1 gap-2"
      >
        <button
          type="button"
          aria-pressed={state.mode === "exact"}
          className={`flex min-h-16 w-full items-center justify-between rounded-lg border bg-white px-4 py-3 text-left font-semibold ${state.mode === "exact" ? "border-emerald-800 text-emerald-950 ring-1 ring-inset ring-emerald-800" : "border-stone-300"}`}
          onClick={() => {
            setExtraCrates([]);
            setExtraBottles([]);
            update({
              emptiesV2: {
                ...state,
                mode: "exact",
                decisions: [],
                returnedCrates: {},
                returnedBottles: {},
              },
            });
          }}
        >
          <span>Yes, all came back</span>
          <span aria-hidden="true">{state.mode === "exact" ? "●" : "○"}</span>
        </button>
        <button
          type="button"
          aria-pressed={state.mode === "actual"}
          className={`flex min-h-16 w-full items-center justify-between rounded-lg border bg-white px-4 py-3 text-left font-semibold ${state.mode === "actual" ? "border-emerald-800 text-emerald-950 ring-1 ring-inset ring-emerald-800" : "border-stone-300"}`}
          onClick={useActualReturns}
        >
          <span>No, some are missing or different</span>
          <span aria-hidden="true">{state.mode === "actual" ? "●" : "○"}</span>
        </button>
      </div>

      {draft.lines.some((line) => line.quantity.crates > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer py-2 font-medium text-emerald-900 underline underline-offset-4">
            Bottles left without their crates?
          </summary>
          <p className="mt-2 text-sm text-stone-600">
            Normal sales use the same number of physical crates as whole crates
            sold. Change only the exceptions, such as bottles carried in a sack.
          </p>
          <div className="mt-4 space-y-4">
            {draft.lines
              .filter((line) => line.quantity.crates > 0)
              .map((line) => (
                <div key={line.productId}>
                  <label htmlFor={`crates-taken-${line.productId}`}>
                    {productName.get(line.productId) ?? "Drink"} · physical
                    crates taken
                  </label>
                  <input
                    id={`crates-taken-${line.productId}`}
                    className="mt-2"
                    inputMode="numeric"
                    pattern="[0-9]+"
                    value={
                      state.cratesTaken[line.productId] ??
                      String(line.quantity.crates)
                    }
                    aria-invalid={Boolean(cratesTakenErrors[line.productId])}
                    aria-describedby={
                      cratesTakenErrors[line.productId]
                        ? `crates-taken-${line.productId}-error`
                        : undefined
                    }
                    onChange={(event) =>
                      update({
                        emptiesV2: {
                          ...state,
                          cratesTaken: {
                            ...state.cratesTaken,
                            [line.productId]: event.target.value,
                          },
                        },
                      })
                    }
                  />
                  {cratesTakenErrors[line.productId] && (
                    <p
                      id={`crates-taken-${line.productId}-error`}
                      role="alert"
                      className="mt-2 text-sm text-red-800"
                    >
                      {cratesTakenErrors[line.productId]}
                    </p>
                  )}
                  <span className="mt-1 block text-sm text-stone-600">
                    Whole crates sold: {line.quantity.crates}. Enter 0 when the
                    bottles leave without a crate.
                  </span>
                </div>
              ))}
          </div>
        </details>
      )}

      {state.mode === "actual" && (
        <div className="space-y-7">
          <p className="text-sm text-stone-600">
            The expected counts are filled in. Change each one to what actually
            came back. Enter 0 if none came back.
          </p>
          <section className="border-t border-stone-300 pt-5">
            <h3 className="text-lg font-semibold">Empty crates returned</h3>
            <p className="mt-1 text-sm text-stone-600">
              Change these counts to the crates that came back.
            </p>
            {visibleCrateIds.size === 0 && (
              <p className="mt-3 text-sm text-stone-600">
                No crates expected for this sale.
              </p>
            )}
            <div className="mt-4 space-y-4">
              {catalog.crateTypes
                .filter((crate) => visibleCrateIds.has(crate.id))
                .map((crate) => (
                  <div key={crate.id}>
                    <label htmlFor={`returned-crate-${crate.id}`}>
                      {crate.name}
                      {crate.pocket_count
                        ? ` · ${crate.pocket_count} pockets`
                        : ""}
                    </label>
                    <input
                      id={`returned-crate-${crate.id}`}
                      className="mt-2"
                      inputMode="numeric"
                      pattern="[0-9]+"
                      value={state.returnedCrates[crate.id] ?? "0"}
                      aria-invalid={Boolean(returnedCrateErrors[crate.id])}
                      aria-describedby={
                        returnedCrateErrors[crate.id]
                          ? `returned-crate-${crate.id}-error`
                          : undefined
                      }
                      onChange={(event) =>
                        update({
                          emptiesV2: {
                            ...state,
                            returnedCrates: {
                              ...state.returnedCrates,
                              [crate.id]: event.target.value,
                            },
                          },
                        })
                      }
                    />
                    {returnedCrateErrors[crate.id] && (
                      <p
                        id={`returned-crate-${crate.id}-error`}
                        role="alert"
                        className="mt-2 text-sm text-red-800"
                      >
                        {returnedCrateErrors[crate.id]}
                      </p>
                    )}
                  </div>
                ))}
            </div>
            {otherCrates.length > 0 && (
              <div className="mt-5">
                <label htmlFor="other-returned-crate">
                  Different crate type came back?
                </label>
                <select
                  id="other-returned-crate"
                  value=""
                  onChange={(event) =>
                    setExtraCrates((current) => [
                      ...current,
                      event.target.value,
                    ])
                  }
                >
                  <option value="" disabled>
                    Choose another crate type
                  </option>
                  {otherCrates.map((crate) => (
                    <option key={crate.id} value={crate.id}>
                      {crate.name}
                      {crate.pocket_count
                        ? ` · ${crate.pocket_count} pockets`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          <section className="border-t border-stone-300 pt-5">
            <h3 className="text-lg font-semibold">Empty bottles returned</h3>
            <p className="mt-1 text-sm text-stone-600">
              Include loose bottles and bottles in sacks.
            </p>
            {visibleBottleTypes.size === 0 && (
              <p className="mt-3 text-sm text-stone-600">
                No bottles expected for this sale.
              </p>
            )}
            <div className="mt-4 space-y-4">
              {bottleTypes
                .filter((type) => visibleBottleTypes.has(type))
                .map((bottleType) => (
                  <div key={bottleType}>
                    <label
                      htmlFor={`returned-bottle-${bottleTypes.indexOf(bottleType)}`}
                    >
                      {bottleType}
                    </label>
                    <input
                      id={`returned-bottle-${bottleTypes.indexOf(bottleType)}`}
                      className="mt-2"
                      inputMode="numeric"
                      pattern="[0-9]+"
                      value={state.returnedBottles[bottleType] ?? "0"}
                      aria-invalid={Boolean(returnedBottleErrors[bottleType])}
                      aria-describedby={
                        returnedBottleErrors[bottleType]
                          ? `returned-bottle-${bottleTypes.indexOf(bottleType)}-error`
                          : undefined
                      }
                      onChange={(event) =>
                        update({
                          emptiesV2: {
                            ...state,
                            returnedBottles: {
                              ...state.returnedBottles,
                              [bottleType]: event.target.value,
                            },
                          },
                        })
                      }
                    />
                    {returnedBottleErrors[bottleType] && (
                      <p
                        id={`returned-bottle-${bottleTypes.indexOf(bottleType)}-error`}
                        role="alert"
                        className="mt-2 text-sm text-red-800"
                      >
                        {returnedBottleErrors[bottleType]}
                      </p>
                    )}
                  </div>
                ))}
            </div>
            {otherBottles.length > 0 && (
              <div className="mt-5">
                <label htmlFor="other-returned-bottle">
                  Different bottle type came back?
                </label>
                <select
                  id="other-returned-bottle"
                  value=""
                  onChange={(event) =>
                    setExtraBottles((current) => [
                      ...current,
                      event.target.value,
                    ])
                  }
                >
                  <option value="" disabled>
                    Choose another bottle type
                  </option>
                  {otherBottles.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>
        </div>
      )}

      {state.mode === "actual" && (
        <details
          className="rounded-xl border border-stone-200 bg-white p-4"
          open={Boolean(state.decisions?.length)}
        >
          <summary className="min-h-12 cursor-pointer py-3 font-semibold">
            Wrong empties? Accept or hold them
          </summary>
          <p className="mb-4 text-sm text-stone-600">
            First enter exactly what came back above. Choose separately for a
            wrong crate and wrong bottles. This choice applies to this sale
            only.
          </p>
          <div className="space-y-4">
            <label className="block">
              Which drink is still missing empties?
              <select
                value={choice.productId}
                onChange={(event) =>
                  setChoice({ ...choice, productId: event.target.value })
                }
              >
                <option value="">Choose a drink</option>
                {draft.lines.map((line) => (
                  <option key={line.productId} value={line.productId}>
                    {productName.get(line.productId)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>What came back wrong?</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["crate", "bottle"] as const).map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={choice.kind === kind ? "primary" : "secondary"}
                    aria-pressed={choice.kind === kind}
                    onClick={() =>
                      setChoice({ ...choice, kind, returnedType: "" })
                    }
                  >
                    {kind === "crate" ? "Plastic crate" : "Bottles"}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              Type that came back
              <select
                value={choice.returnedType}
                onChange={(event) =>
                  setChoice({ ...choice, returnedType: event.target.value })
                }
              >
                <option value="">Choose the returned type</option>
                {(choice.kind === "crate"
                  ? catalog.crateTypes.map((item) => ({
                      id: item.id,
                      name: item.name,
                    }))
                  : bottleTypes.map((type) => ({ id: type, name: type }))
                ).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              How many {choice.kind === "crate" ? "crates" : "bottles"}?
              <input
                inputMode="numeric"
                value={choice.quantity}
                onChange={(event) =>
                  setChoice({ ...choice, quantity: event.target.value })
                }
              />
            </label>
            <fieldset>
              <legend>What should happen?</legend>
              <div className="mt-2 space-y-2">
                {(["hold", "accept"] as const).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    className={`w-full text-left ${choice.decision === decision ? "primary" : "secondary"}`}
                    aria-pressed={choice.decision === decision}
                    onClick={() => setChoice({ ...choice, decision })}
                  >
                    {decision === "hold"
                      ? "Hold these · correct type is still owed"
                      : "Accept these · reduce what is owed"}
                  </button>
                ))}
              </div>
            </fieldset>
            {choiceError && (
              <p role="alert" className="text-red-800">
                {choiceError}
              </p>
            )}
            <button
              type="button"
              className="secondary w-full"
              onClick={() => {
                const next = {
                  ...state,
                  decisions: [...(state.decisions ?? []), choice],
                };
                try {
                  matchSaleEmpties({ ...draft, emptiesV2: next }, catalog);
                  update({ emptiesV2: next });
                  setChoiceError("");
                } catch (cause) {
                  setChoiceError(
                    cause instanceof Error
                      ? cause.message
                      : "Check this choice.",
                  );
                }
              }}
            >
              Add this choice
            </button>
          </div>
          {(state.decisions ?? []).map((entry, index) => (
            <div key={index} className="mt-4 rounded-lg bg-stone-50 p-3">
              <p className="font-semibold">
                {productName.get(entry.productId)} · {entry.quantity}{" "}
                {entry.kind === "crate"
                  ? crateName.get(entry.returnedType)
                  : entry.returnedType}{" "}
                {entry.kind === "crate" ? "crates" : "bottles"}
              </p>
              <p className="mt-1">
                {entry.decision === "hold"
                  ? "Held for this customer. Correct type is still owed."
                  : "Accepted for this sale. Reduces what is owed."}
              </p>
              <button
                type="button"
                className="quiet-link mt-1"
                onClick={() =>
                  update({
                    emptiesV2: {
                      ...state,
                      decisions: state.decisions?.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    },
                  })
                }
              >
                Remove choice
              </button>
            </div>
          ))}
        </details>
      )}

      {hasFieldErrors && (
        <p role="alert" className="text-red-800">
          Check the highlighted fields. Everything you entered is still here.
        </p>
      )}
      {error && !hasFieldErrors && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}

      {result && (
        <section
          aria-live="polite"
          className="rounded-lg border border-stone-200 bg-white p-4"
        >
          <h3 className="font-semibold">
            {shortages.length ? "Still missing" : "Empties checked"}
          </h3>

          {result.swaps.map((swap) => (
            <p key={`${swap.owedCrateTypeId}:${swap.returnedCrateTypeId}`}>
              {swap.quantity}{" "}
              {crateName.get(swap.returnedCrateTypeId) ?? "returned crate"}{" "}
              {swap.quantity === 1 ? "crate" : "crates"} accepted for{" "}
              {crateName.get(swap.owedCrateTypeId) ?? "the expected crate"}.
            </p>
          ))}

          {!shortages.length ? (
            <p className="mt-2 text-emerald-900">
              No empty crates or bottles owed from this sale.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {shortages.map((line) => (
                <p key={line.productId}>
                  {missingEmptiesMessage(
                    line,
                    productName.get(line.productId) ?? "Drink",
                  )}
                </p>
              ))}
            </div>
          )}

          {crateIssues.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="font-medium">Different crates to check</p>
              {crateIssues.map((issue) => {
                const returnedName =
                  crateName.get(issue.returnedCrateTypeId) ?? "Returned crate";
                const owedName = issue.owedCrateTypeId
                  ? (crateName.get(issue.owedCrateTypeId) ??
                    "the expected crate")
                  : null;
                if (issue.reason === "not_allowed" && owedName)
                  return (
                    <p
                      role="alert"
                      className="text-amber-900"
                      key={issue.returnedCrateTypeId}
                    >
                      {returnedName} has not been accepted for {owedName}.
                      Choose above whether to accept or hold it.
                    </p>
                  );
                if (issue.reason === "incomplete_allowed_swap" && owedName)
                  return (
                    <p
                      role="alert"
                      className="text-amber-900"
                      key={issue.returnedCrateTypeId}
                    >
                      {returnedName} can replace {owedName} only when complete.{" "}
                      {issue.matchingBottlesReturned ?? 0} of{" "}
                      {issue.matchingBottlesNeeded ?? 0} matching bottles came
                      back.
                    </p>
                  );
                return (
                  <p className="text-stone-700" key={issue.returnedCrateTypeId}>
                    {issue.quantity} {issue.quantity === 1 ? "crate" : "crates"}{" "}
                    of {returnedName} came back, but{" "}
                    {issue.quantity === 1 ? "it did" : "they did"} not settle a
                    crate in this sale.
                  </p>
                );
              })}
            </div>
          )}

          {Object.keys(result.unmatchedBottles).length > 0 && (
            <div className="mt-4">
              <p className="font-medium">Other bottles that came back</p>
              {Object.entries(result.unmatchedBottles).map(
                ([type, quantity]) => (
                  <p key={type}>
                    {type} · {quantity}
                  </p>
                ),
              )}
            </div>
          )}

          {hasUnmatchedSaleEmpties(result) && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-amber-950">Choose Accept or Hold above for each different type before continuing. Extra empties for an earlier sale belong under “Record empties brought back” on the customer page.</p>}
          {depositBlocked && missingDepositSetup.length > 0 && (
            <div
              role="alert"
              className="mt-4 border-l-4 border-amber-700 pl-3 text-amber-950"
            >
              <p className="font-semibold">Deposit setup is incomplete.</p>
              {missingDepositSetup.map((issue) => (
                <p className="mt-1" key={issue.key}>
                  {issue.message}
                </p>
              ))}
              <Link
                href="/empties-rules"
                className="quiet-link mt-2 inline-block"
              >
                Set deposit prices
              </Link>
            </div>
          )}
          {depositBlocked && missingDepositSetup.length === 0 && (
            <p role="alert" className="mt-4 text-amber-900">
              This customer requires a deposit for the missing empties. The
              prices are configured, but collecting the refundable deposit in
              this sale is not enabled yet.
            </p>
          )}
        </section>
      )}

      <div className="sale-sticky-actions sticky z-10 -mx-4 flex items-center gap-3 border-t border-stone-200 bg-background px-4 pb-4 pt-3 sm:mx-0 sm:px-0">
        <button
          type="button"
          className="min-h-12 shrink-0 px-2 font-semibold text-emerald-900 underline underline-offset-4"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="primary min-w-0 flex-1"
          disabled={
            hasFieldErrors || !result || hasUnmatchedSaleEmpties(result) || Boolean(error) || depositBlocked
          }
          onClick={() => update({ step: "payment" })}
        >
          Next: Enter payment
        </button>
      </div>
    </>
  );
}
