"use client";

import Link from "next/link";
import {
  crateReturnIssues,
  depositSetupIssues,
  matchSaleEmpties,
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
  const customer = catalog.customers.find((item) => item.id === draft.customerId);
  const crateName = new Map(catalog.crateTypes.map((crate) => [crate.id, crate.name]));
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
    error = cause instanceof Error ? cause.message : "Check the returned empties.";
  }

  function useActualReturns() {
    try {
      const exactDraft: SaleDraft = {
        ...draft,
        emptiesV2: { ...state, mode: "exact" },
      };
      const exact = matchSaleEmpties(exactDraft, catalog);
      const returnedCrates: Record<string, string> = {};
      const returnedBottles: Record<string, string> = {};
      for (const line of exact.lines) {
        add(returnedCrates, line.crateTypeId, line.cratesOut);
        if (line.bottleType) add(returnedBottles, line.bottleType, line.bottlesOut);
      }
      update({
        emptiesV2: {
          ...state,
          mode: "actual",
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
      <h2 className="text-xl font-semibold">Did all expected empties come back?</h2>

      {draft.lines.some((line) => line.quantity.crates > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer py-2 font-medium text-emerald-900 underline underline-offset-4">
            Bottles left without their crates?
          </summary>
          <p className="mt-2 text-sm text-stone-600">
            Normal sales use the same number of physical crates as whole crates sold.
            Change only the exceptions, such as bottles carried in a sack.
          </p>
          <div className="mt-4 space-y-4">
            {draft.lines
              .filter((line) => line.quantity.crates > 0)
              .map((line) => (
                <div key={line.productId}>
                  <label htmlFor={`crates-taken-${line.productId}`}>
                    {productName.get(line.productId) ?? "Drink"} · physical crates taken
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

      <div role="group" aria-label="Empties returned" className="grid grid-cols-1 gap-2">
        <button
          type="button"
          aria-pressed={state.mode === "exact"}
          className={`flex min-h-16 w-full items-center justify-between rounded-lg border px-4 py-3 text-left font-semibold ${state.mode === "exact" ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-300 bg-white"}`}
          onClick={() =>
            update({
              emptiesV2: {
                ...state,
                mode: "exact",
                returnedCrates: {},
                returnedBottles: {},
              },
            })
          }
        >
          <span>Yes, all came back</span>
          <span aria-hidden="true">{state.mode === "exact" ? "●" : "○"}</span>
        </button>
        <button
          type="button"
          aria-pressed={state.mode === "actual"}
          className={`flex min-h-16 w-full items-center justify-between rounded-lg border px-4 py-3 text-left font-semibold ${state.mode === "actual" ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-300 bg-white"}`}
          onClick={useActualReturns}
        >
          <span>No, some are missing or different</span>
          <span aria-hidden="true">{state.mode === "actual" ? "●" : "○"}</span>
        </button>
      </div>

      {state.mode === "actual" && (
        <div className="space-y-7">
          <section className="border-t border-stone-300 pt-5">
            <h3 className="font-semibold">Crates actually returned</h3>
            <p className="mt-1 text-sm text-stone-600">
              Record the real crate type, even when it is different from the drink bought.
            </p>
            <div className="mt-4 space-y-4">
              {catalog.crateTypes.map((crate) => (
                <div key={crate.id}>
                  <label htmlFor={`returned-crate-${crate.id}`}>
                    {crate.name}
                    {crate.pocket_count ? ` · ${crate.pocket_count} pockets` : ""}
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
          </section>

          <section className="border-t border-stone-300 pt-5">
            <h3 className="font-semibold">Bottles actually returned</h3>
            <p className="mt-1 text-sm text-stone-600">
              Count bottles by the type that physically came back, including bottles in sacks.
            </p>
            <div className="mt-4 space-y-4">
              {bottleTypes.map((bottleType, index) => (
                <div key={bottleType}>
                  <label htmlFor={`returned-bottle-${index}`}>
                    {bottleType}
                  </label>
                  <input
                    id={`returned-bottle-${index}`}
                    className="mt-2"
                    inputMode="numeric"
                    pattern="[0-9]+"
                    value={state.returnedBottles[bottleType] ?? "0"}
                    aria-invalid={Boolean(returnedBottleErrors[bottleType])}
                    aria-describedby={
                      returnedBottleErrors[bottleType]
                        ? `returned-bottle-${index}-error`
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
                      id={`returned-bottle-${index}-error`}
                      role="alert"
                      className="mt-2 text-sm text-red-800"
                    >
                      {returnedBottleErrors[bottleType]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
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
        <section aria-live="polite" className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-600">Empties summary</h3>

          {result.swaps.map((swap) => (
            <p key={`${swap.owedCrateTypeId}:${swap.returnedCrateTypeId}`}>
              {swap.quantity} {crateName.get(swap.returnedCrateTypeId) ?? "returned crate"}{" "}
              {swap.quantity === 1 ? "crate" : "crates"} accepted for{" "}
              {crateName.get(swap.owedCrateTypeId) ?? "the expected crate"}.
            </p>
          ))}

          {!shortages.length ? (
            <p className="mt-2 text-emerald-900">Empties are settled.</p>
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
              <p className="font-medium">Crates that did not settle automatically</p>
              {crateIssues.map((issue) => {
                const returnedName =
                  crateName.get(issue.returnedCrateTypeId) ?? "Returned crate";
                const owedName = issue.owedCrateTypeId
                  ? crateName.get(issue.owedCrateTypeId) ?? "the expected crate"
                  : null;
                if (issue.reason === "not_allowed" && owedName)
                  return (
                    <p
                      role="alert"
                      className="text-amber-900"
                      key={issue.returnedCrateTypeId}
                    >
                      {returnedName} cannot replace {owedName}. It was still
                      recorded as what came back.
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
                  <p
                    className="text-stone-700"
                    key={issue.returnedCrateTypeId}
                  >
                    {issue.quantity}{" "}
                    {issue.quantity === 1 ? "crate" : "crates"} of{" "}
                    {returnedName} came back, but{" "}
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
              {Object.entries(result.unmatchedBottles).map(([type, quantity]) => (
                <p key={type}>
                  {type} · {quantity}
                </p>
              ))}
            </div>
          )}

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

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-stone-200 bg-[#f7f8f4] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-0 sm:px-0">
        <button type="button" className="min-h-12 shrink-0 px-2 font-semibold text-emerald-900 underline underline-offset-4" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="primary min-w-0 flex-1"
          disabled={hasFieldErrors || !result || Boolean(error) || depositBlocked}
          onClick={() => update({ step: "payment" })}
        >
          Continue to payment
        </button>
      </div>
    </>
  );
}
