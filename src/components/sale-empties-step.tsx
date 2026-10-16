"use client";

import { useState } from "react";
import Link from "next/link";
import { SaleIcon } from "@/components/sale-icon";
import { EmptyQuantityRow } from "@/components/empty-quantity-row";
import { BulkEmptyReturnGroup } from "@/components/bulk-empty-return-group";
import { bulkReturnGroups, bulkReturnParts } from "@/domain/bulk-empties";
import {
  crateReturnIssues,
  allReturnedConfirmationKey,
  hasConfirmedAllReturned,
  isQuickRetailEmptiesSale,
  paymentStepAfterEmpties,
  depositSetupIssues,
  matchSaleEmpties,
  hasUnmatchedSaleEmpties,
  leaveUnrelatedEmptiesOutOfSale,
  missingEmptiesMessage,
  simpleBottleReturnChoice,
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

function selectDefaultZero(event: { currentTarget: HTMLInputElement }) {
  if (event.currentTarget.value === "0") event.currentTarget.select();
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
  const [separateConfirmation, setSeparateConfirmation] = useState("");
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
        `${crate.name} empty crates returned`,
      );
      if (message) returnedCrateErrors[crate.id] = message;
    }
    for (const bottleType of bottleTypes) {
      const raw = state.returnedBottles[bottleType];
      if (raw === undefined) continue;
      const message = wholeNumberInputMessage(
        raw,
        `${bottleType} empty bottles returned`,
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
          confirmedAllReturned: null,
          decisions: [],
          returnedCrates,
          returnedBottles,
        },
      });
    } catch {
      update({ emptiesV2: { ...state, mode: "actual", confirmedAllReturned: null } });
    }
  }

  const exactConfirmed = Boolean(expected && hasConfirmedAllReturned(draft, expected));
  const expectedCrates = new Map<string, number>();
  const expectedBottles = new Map<string, number>();
  for (const line of expected?.lines ?? []) {
    expectedCrates.set(line.crateTypeId, (expectedCrates.get(line.crateTypeId) ?? 0) + line.cratesOut);
    if (line.bottleType)
      expectedBottles.set(line.bottleType, (expectedBottles.get(line.bottleType) ?? 0) + line.bottlesOut);
  }
  const totalExpectedCrates = [...expectedCrates.values()].reduce((sum, n) => sum + n, 0);
  const totalExpectedBottles = [...expectedBottles.values()].reduce((sum, n) => sum + n, 0);
  const bulkGroups = expected ? bulkReturnGroups(expected, catalog) : [];
  const visibleBulkGroups = bulkGroups.filter((group) =>
    bulkReturnParts(
      state.returnedCrates[group.crateTypeId] ?? "0",
      state.returnedBottles[group.bottleType] ?? "0",
      group.pocketCount,
    ),
  );
  const bulkCrateIds = new Set(visibleBulkGroups.map((group) => group.crateTypeId));
  const bulkBottleTypes = new Set(visibleBulkGroups.map((group) => group.bottleType));
  const quickRetailSale = isQuickRetailEmptiesSale(draft);

  const shortages =
    result?.lines.filter((line) => line.cratesOwed || line.bottlesOwed) ?? [];
  const crateIssues = result ? crateReturnIssues(result, catalog) : [];
  const depositBlocked =
    Boolean(customer?.empties_deposit_required) && shortages.length > 0;
  const missingDepositSetup =
    depositBlocked && result ? depositSetupIssues(result, catalog) : [];

  const actualCratesDiffer = [...expectedCrates].some(
    ([type, count]) => Number(state.returnedCrates[type] ?? "0") !== count,
  ) || Object.entries(state.returnedCrates).some(([type, value]) => !expectedCrates.has(type) && Number(value) > 0);
  const actualBottlesDiffer = [...expectedBottles].some(
    ([type, count]) => Number(state.returnedBottles[type] ?? "0") !== count,
  ) || Object.entries(state.returnedBottles).some(([type, value]) => !expectedBottles.has(type) && Number(value) > 0);
  const physicalCratesDiffer = draft.lines.some(
    (line) => state.cratesTaken[line.productId] !== undefined && Number(state.cratesTaken[line.productId]) !== line.quantity.crates,
  );
  const actualHasException = actualCratesDiffer || actualBottlesDiffer || physicalCratesDiffer || (state.decisions?.length ?? 0) > 0;

  const unmatchedCrateTypes = Object.entries(result?.unmatchedCrates ?? {}).filter(([, count]) => count > 0);
  const unmatchedBottleTypes = Object.entries(result?.unmatchedBottles ?? {}).filter(([, count]) => count > 0);
  const decisionKind = (choice.kind === "crate" && unmatchedCrateTypes.length > 0)
    || (choice.kind === "bottle" && unmatchedBottleTypes.length > 0)
    ? choice.kind : unmatchedCrateTypes.length > 0 ? "crate" : "bottle";
  const availableWrongTypes = decisionKind === "crate" ? unmatchedCrateTypes : unmatchedBottleTypes;
  const missingForChoice = (result?.lines ?? []).filter(
    (line) => decisionKind === "crate" ? line.cratesOwed > 0 : line.bottlesOwed > 0,
  );
  const chosenMissing = missingForChoice.find((line) => line.productId === choice.productId) ?? missingForChoice[0];
  const chosenWrongType = availableWrongTypes.find(([type]) => type === choice.returnedType)?.[0] ?? availableWrongTypes[0]?.[0] ?? "";
  const selectedWasEdited = choice.kind === decisionKind && choice.productId === chosenMissing?.productId && choice.returnedType === chosenWrongType;
  const missingQuantity = chosenMissing ? (decisionKind === "crate" ? chosenMissing.cratesOwed : chosenMissing.bottlesOwed) : 0;
  const wrongQuantity = availableWrongTypes.find(([type]) => type === chosenWrongType)?.[1] ?? 0;
  const suggestedQuantity = String(Math.min(missingQuantity, wrongQuantity));
  const chosenDecisionQuantity = selectedWasEdited && choice.quantity ? choice.quantity : suggestedQuantity;
  const decisionHasUnmatched = unmatchedCrateTypes.length > 0 || unmatchedBottleTypes.length > 0;
  const simpleDecisionPair = missingForChoice.length === 1 && availableWrongTypes.length === 1 && Number(suggestedQuantity) > 0;

  // One wrong loose bottle type should require a decision, not another round
  // of selecting its type and re-entering the same count.
  const simpleBottleReturn = state.mode === "actual" && result
    ? simpleBottleReturnChoice(result)
    : null;

  function decideSimpleBottleReturn(decision: "accept" | "hold") {
    if (!simpleBottleReturn) return;
    const next = {
      ...state,
      decisions: [...(state.decisions ?? []), {
        productId: simpleBottleReturn.productId,
        kind: "bottle" as const,
        returnedType: simpleBottleReturn.returnedType,
        quantity: String(simpleBottleReturn.quantity),
        decision,
      }],
    };
    try {
      matchSaleEmpties({ ...draft, emptiesV2: next }, catalog);
      update({ emptiesV2: next });
      setChoiceError("");
    } catch (cause) {
      setChoiceError(cause instanceof Error ? cause.message : "Check this choice.");
    }
  }

  return (
    <>
      <section aria-labelledby="empties-choice-heading" className="space-y-4">
        <div>
          <h2 id="empties-choice-heading" className="text-xl font-bold text-stone-950">What came back?</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Check the empty crates and empty bottles returned for this sale. Nothing is recorded until you save.
          </p>
        </div>
        {expected && (
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm font-semibold text-stone-700">Expected with this sale</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><strong className="block text-3xl tabular-nums text-stone-950">{totalExpectedCrates}</strong><span className="text-sm text-stone-600">Empty crates</span></div>
              <div><strong className="block text-3xl tabular-nums text-stone-950">{totalExpectedBottles}</strong><span className="text-sm text-stone-600">Empty bottles</span></div>
            </div>
            {(expectedCrates.size > 0 || expectedBottles.size > 0) && (
              <details className="mt-3 border-t border-stone-200 pt-2 text-sm">
                <summary className="cursor-pointer py-2 font-semibold text-emerald-900">See empty crate and empty bottle types</summary>
                <ul className="mt-2 space-y-1 text-stone-700">
                  {[...expectedCrates].filter(([, count]) => count > 0).map(([type, count]) => (
                    <li key={"crate-" + type}>{count} {crateName.get(type) ?? "Unknown"} {count === 1 ? "empty crate" : "empty crates"}</li>
                  ))}
                  {[...expectedBottles].filter(([, count]) => count > 0).map(([type, count]) => (
                    <li key={"bottle-" + type}>{count} {type} {count === 1 ? "empty bottle" : "empty bottles"}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div role="group" aria-label="Empties returned" className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            aria-pressed={exactConfirmed}
            className={"flex min-h-24 items-start justify-between gap-3 rounded-xl border-2 p-4 text-left disabled:opacity-60 " + (exactConfirmed ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-200 bg-white text-stone-900 hover:border-emerald-300")}
            disabled={!expected || hasFieldErrors}
            onClick={() => {
              if (!expected) return;
              setExtraCrates([]);
              setExtraBottles([]);
              update({
                ...(quickRetailSale ? { step: "payment" as const } : {}),
                emptiesV2: {
                  ...state,
                  mode: "exact",
                  confirmedAllReturned: allReturnedConfirmationKey(draft, expected),
                  decisions: [],
                  returnedCrates: {},
                  returnedBottles: {},
                },
              });
            }}
          >
            <span>
              <strong className="block text-base">{exactConfirmed ? "All returned · Confirmed" : "Yes, all empty returns received"}</strong>
              <span className="mt-1 block text-sm leading-5">I checked: all expected empty crates and empty bottles came back</span>
            </span>
            <span className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 " + (exactConfirmed ? "border-emerald-800 bg-emerald-800 text-white" : "border-stone-400")} aria-hidden="true">
              {exactConfirmed && <SaleIcon name="check" className="h-4 w-4" />}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={state.mode === "actual"}
            className={"flex min-h-24 items-start justify-between gap-3 rounded-xl border-2 p-4 text-left " + (state.mode === "actual" ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-200 bg-white text-stone-900 hover:border-emerald-300")}
            onClick={useActualReturns}
          >
            <span>
              <strong className="block text-base">Something is different</strong>
              <span className="mt-1 block text-sm leading-5">Some empty crates or empty bottles are missing, extra or different</span>
            </span>
            <span className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 " + (state.mode === "actual" ? "border-emerald-800 bg-emerald-800 text-white" : "border-stone-400")} aria-hidden="true">
              {state.mode === "actual" && <SaleIcon name="check" className="h-4 w-4" />}
            </span>
          </button>
        </div>
        {state.mode === "exact" && (
          <p role="status" className={"flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium " + (exactConfirmed ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950")}>
            <SaleIcon name={exactConfirmed ? "check" : "shield"} className="h-4 w-4 shrink-0" />
            {exactConfirmed
              ? "Confirmed. The empty crates and empty bottles will be recorded when the sale is saved."
              : "Not yet confirmed. Check the empty crates and empty bottles, then tap “Yes, all returned”."}
          </p>
        )}
      </section>

      {draft.lines.some((line) => line.quantity.crates > 0) && (
        <details className="rounded-xl border border-stone-200 bg-white p-3 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-stone-800">
            Did any drinks leave without their plastic crates?
          </summary>
          <p className="mt-2 text-sm text-stone-600">
            Usually a customer takes the plastic crate with a whole-crate purchase. Only change this if the customer took the bottles without the crate.
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
                      onFocus={selectDefaultZero}
                      onClick={selectDefaultZero}
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
                          confirmedAllReturned: null,
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
        <section aria-labelledby="returned-quantity-heading" className="space-y-4">
          <div>
            <h3 id="returned-quantity-heading" className="text-lg font-bold text-stone-950">Enter what actually came back</h3>
            <p className="mt-1 text-sm leading-5 text-stone-600">
              We filled in the expected amounts to save time. Change only what is missing, extra, or different. Set 0 when none came back.
            </p>
          </div>
          {visibleBulkGroups.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-stone-950">Large empty returns · count complete sets first</p>
              {visibleBulkGroups.map((group) => (
                <BulkEmptyReturnGroup
                  key={group.crateTypeId}
                  group={group}
                  returnedCrates={state.returnedCrates[group.crateTypeId] ?? "0"}
                  returnedBottles={state.returnedBottles[group.bottleType] ?? "0"}
                  onChange={({ crates, bottles }) => update({
                    emptiesV2: {
                      ...state,
                      returnedCrates: { ...state.returnedCrates, [group.crateTypeId]: crates },
                      returnedBottles: { ...state.returnedBottles, [group.bottleType]: bottles },
                    },
                  })}
                />
              ))}
            </div>
          )}
          {visibleCrateIds.size > bulkCrateIds.size && (
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-stone-900">Empty crates returned</h4>
              {catalog.crateTypes.filter((crate) => visibleCrateIds.has(crate.id) && !bulkCrateIds.has(crate.id)).map((crate) => (
                <EmptyQuantityRow
                  key={crate.id}
                  id={`returned-crate-${crate.id}`}
                  name={`${crate.name} empty crates`}
                  detail={crate.pocket_count ? `${crate.pocket_count} pockets` : undefined}
                  expected={expectedCrates.get(crate.id) ?? 0}
                  value={state.returnedCrates[crate.id] ?? "0"}
                  unit="crate"
                  error={returnedCrateErrors[crate.id]}
                  onChange={(value) => update({ emptiesV2: { ...state, returnedCrates: { ...state.returnedCrates, [crate.id]: value } } })}
                />
              ))}
            </div>
          )}
          {visibleBottleTypes.size > bulkBottleTypes.size && (
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-stone-900">Empty bottles returned</h4>
              {bottleTypes.filter((type) => visibleBottleTypes.has(type) && !bulkBottleTypes.has(type)).map((bottleType) => (
                <EmptyQuantityRow
                  key={bottleType}
                  id={`returned-bottle-${bottleTypes.indexOf(bottleType)}`}
                  name={`Empty bottles · ${bottleType}`}
                  expected={expectedBottles.get(bottleType) ?? 0}
                  value={state.returnedBottles[bottleType] ?? "0"}
                  unit="bottle"
                  error={returnedBottleErrors[bottleType]}
                  onChange={(value) => update({ emptiesV2: { ...state, returnedBottles: { ...state.returnedBottles, [bottleType]: value } } })}
                />
              ))}
            </div>
          )}
          {(otherCrates.length > 0 || otherBottles.length > 0) && (
            <details className="rounded-xl border border-stone-200 bg-white px-3 py-2 sm:px-4">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold text-emerald-900">
                Different type brought back? Add it here
              </summary>
              <div className="grid gap-3 border-t border-stone-200 py-3 sm:grid-cols-2">
                {otherCrates.length > 0 && (
                  <label htmlFor="other-returned-crate" className="text-sm font-semibold text-stone-800">
                    Different empty crate type
                    <select
                      id="other-returned-crate"
                      className="mt-2"
                      value=""
                      onChange={(event) => {
                        if (event.target.value) setExtraCrates((current) => [...new Set([...current, event.target.value])]);
                      }}
                    >
                      <option value="">Choose a type to add</option>
                      {otherCrates.map((crate) => <option key={crate.id} value={crate.id}>{crate.name}{crate.pocket_count ? ` · ${crate.pocket_count} pockets` : ""}</option>)}
                    </select>
                  </label>
                )}
                {otherBottles.length > 0 && (
                  <label htmlFor="other-returned-bottle" className="text-sm font-semibold text-stone-800">
                    Different empty bottle type
                    <select
                      id="other-returned-bottle"
                      className="mt-2"
                      value=""
                      onChange={(event) => {
                        if (event.target.value) setExtraBottles((current) => [...new Set([...current, event.target.value])]);
                      }}
                    >
                      <option value="">Choose a type to add</option>
                      {otherBottles.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <p className="pb-2 text-xs text-stone-600">
                Enter the quantity in the new row. DepotFlow will ask what you did with it if it cannot settle this sale.
              </p>
            </details>
          )}
        </section>
      )}

      {state.mode === "actual" && (
        <div className="space-y-3">
          {result && (shortages.length > 0 || actualHasException) && (
            <section aria-live="polite" className="rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4">
              <h3 className="font-bold text-amber-950">
                {shortages.length > 0 ? "Still owed if saved" : "All expected empties accounted for"}
              </h3>
              {shortages.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-amber-950">
                  {shortages.map((line) => (
                    <li key={line.productId}>{missingEmptiesMessage(line, productName.get(line.productId) ?? "Drink")}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-emerald-950">No new empty crates or empty bottles owed from this sale.</p>
              )}
              <p className="mt-2 text-xs text-stone-700">Preview only. The customer&apos;s record changes when the sale is saved.</p>
            </section>
          )}

          {simpleBottleReturn && (
            <section aria-label="Different empty bottle returned" className="rounded-xl border border-amber-200 bg-white p-4">
              <h3 className="text-base font-bold text-stone-950">Different empty bottle received</h3>
              <p className="mt-2 text-sm leading-5 text-stone-700">
                {simpleBottleReturn.quantity} {simpleBottleReturn.returnedType} {simpleBottleReturn.quantity === 1 ? "empty bottle" : "empty bottles"} came back instead of {simpleBottleReturn.expectedType} for {productName.get(simpleBottleReturn.productId)}.
              </p>
              <p className="mt-3 text-sm font-bold">What did you do with {simpleBottleReturn.quantity === 1 ? "it" : "them"}?</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button type="button" className="secondary min-h-14 w-full text-sm" onClick={() => decideSimpleBottleReturn("hold")}>
                  Kept aside · Correct type still owed
                </button>
                <button type="button" className="secondary min-h-14 w-full text-sm" onClick={() => decideSimpleBottleReturn("accept")}>
                  Accepted instead · Reduces empty bottles still owed
                </button>
              </div>
              {choiceError && <p role="alert" className="mt-2 text-sm text-red-800">{choiceError}</p>}
            </section>
          )}

          {result && !simpleBottleReturn && decisionHasUnmatched && (
            <section aria-labelledby="different-return-heading" className="space-y-3 rounded-xl border border-amber-200 bg-white p-4">
              <div>
                <h3 id="different-return-heading" className="text-lg font-bold text-stone-950">Different empties need a decision</h3>
                <p className="mt-1 text-sm leading-5 text-stone-600">
                  A different empty crate or empty bottle will not automatically clear what the customer owes.
                </p>
              </div>
              {unmatchedCrateTypes.length > 0 && unmatchedBottleTypes.length > 0 && (
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Type of different empties">
                  {(["crate", "bottle"] as const).map((kind) => (
                    <button key={kind} type="button" className={decisionKind === kind ? "primary min-h-12" : "secondary min-h-12"}
                      aria-pressed={decisionKind === kind}
                      onClick={() => setChoice({ productId: "", kind, returnedType: "", quantity: "", decision: "hold" })}>
                      {kind === "crate" ? "Empty crates" : "Empty bottles"}
                    </button>
                  ))}
                </div>
              )}
              {missingForChoice.length > 0 ? (
                <>
                  {simpleDecisionPair ? (
                    <p className="rounded-lg bg-stone-50 px-3 py-3 text-sm leading-6 text-stone-800">
                      <strong>{wrongQuantity} {decisionKind === "crate" ? "empty crates" : "empty bottles"} of {decisionKind === "crate" ? crateName.get(chosenWrongType) ?? chosenWrongType : chosenWrongType}</strong> came back.
                      {" "}For this sale, <strong>{missingQuantity} {decisionKind === "crate" ? "empty crates" : "empty bottles"} of {productName.get(chosenMissing?.productId ?? "") ?? "the drink"}</strong> are still owed.
                      {" "}Choose what to do with {suggestedQuantity} of the different empties.
                    </p>
                  ) : (<>
                  <label className="block text-sm font-semibold text-stone-800">
                    Which drink still has {decisionKind === "crate" ? "empty crates" : "empty bottles"} missing?
                    <select className="mt-1.5" value={chosenMissing?.productId ?? ""}
                      onChange={(event) => setChoice({ ...choice, kind: decisionKind, productId: event.target.value, returnedType: chosenWrongType, quantity: "" })}>
                      {missingForChoice.map((line) => (
                        <option key={line.productId} value={line.productId}>{productName.get(line.productId) ?? "Drink"} · {decisionKind === "crate" ? line.cratesOwed : line.bottlesOwed} still owed</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-stone-800">
                    What different type came back?
                    <select className="mt-1.5" value={chosenWrongType}
                      onChange={(event) => setChoice({ ...choice, kind: decisionKind, productId: chosenMissing?.productId ?? "", returnedType: event.target.value, quantity: "" })}>
                      {availableWrongTypes.map(([type, quantity]) => (
                        <option key={type} value={type}>
                          {decisionKind === "crate" ? crateName.get(type) ?? type : type} · {quantity} available
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-stone-800">
                    How many {decisionKind === "crate" ? "empty crates" : "empty bottles"} does this affect?
                    <input className="mt-1.5" inputMode="numeric" pattern="[0-9]+"
                      value={chosenDecisionQuantity} onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setChoice({ ...choice, kind: decisionKind, productId: chosenMissing?.productId ?? "", returnedType: chosenWrongType, quantity: event.target.value })}/>
                    <span className="mt-1 block text-xs font-normal text-stone-600">Suggested: {suggestedQuantity} · change if fewer were involved.</span>
                  </label>
                  </>)}
                  <fieldset>
                    <legend className="text-sm font-bold text-stone-900">What happened to the different empties?</legend>
                    <div className="mt-2 grid gap-2">
                      {(["hold", "accept"] as const).map((decision) => (
                        <button key={decision} type="button"
                          className={"min-h-12 rounded-lg border-2 p-3 text-left text-sm " + (choice.decision === decision ? "border-emerald-800 bg-emerald-50 font-semibold text-emerald-950" : "border-stone-200 bg-white text-stone-800")}
                          aria-pressed={choice.decision === decision}
                          onClick={() => setChoice({ ...choice, decision })}>
                          {decision === "hold"
                            ? "Kept aside · Customer still owes the correct type"
                            : "Accepted as replacement · Reduces the amount owed"}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {choiceError && <p role="alert" className="text-sm font-medium text-red-800">{choiceError}</p>}
                  <button type="button" className="primary w-full min-h-12" onClick={() => {
                    const nextChoice = {
                      productId: chosenMissing?.productId ?? "",
                      kind: decisionKind,
                      returnedType: chosenWrongType,
                      quantity: chosenDecisionQuantity,
                      decision: choice.decision,
                    };
                    const next = { ...state, decisions: [...(state.decisions ?? []), nextChoice] };
                    try {
                      matchSaleEmpties({ ...draft, emptiesV2: next }, catalog);
                      update({ emptiesV2: next });
                      setChoice({ productId: "", kind: "crate", returnedType: "", quantity: "", decision: "hold" });
                      setChoiceError("");
                    } catch (cause) {
                      setChoiceError(cause instanceof Error ? cause.message : "Check this choice.");
                    }
                  }}>Record what happened</button>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm leading-6 text-stone-700">
                    These extra empties are not owed in today&apos;s sale. Leave them out here, then record the earlier return from the customer&apos;s page.
                  </p>
                  {availableWrongTypes.map(([type, quantity]) => {
                    const label = decisionKind === "crate" ? crateName.get(type) ?? type : type;
                    const key = `${decisionKind}:${type}`;
                    return (
                      <div key={key} className="rounded-xl border border-stone-200 p-3">
                        <p className="font-semibold text-stone-900">{quantity} {label} {decisionKind === "crate" ? "empty crates" : "empty bottles"}</p>
                        {separateConfirmation === key ? (
                          <div className="mt-3 space-y-3">
                            <p role="alert" className="text-sm text-amber-950">
                              This will remove the extra {decisionKind === "crate" ? "crate" : "bottle"} count from today&apos;s sale only. It will NOT record the earlier return or add it to stock. Record that return separately on the customer page.
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <button type="button" className="secondary min-h-12" onClick={() => setSeparateConfirmation("")}>Cancel</button>
                              <button type="button" className="primary min-h-12" onClick={() => {
                                try {
                                  update({ emptiesV2: leaveUnrelatedEmptiesOutOfSale(draft, result!, decisionKind, type) });
                                  setSeparateConfirmation("");
                                  setChoiceError("");
                                } catch (cause) {
                                  setChoiceError(cause instanceof Error ? cause.message : "Check the returned empties.");
                                }
                              }}>Confirm: leave out</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="secondary mt-3 min-h-12 w-full" onClick={() => setSeparateConfirmation(key)}>
                            Leave out of this sale
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {choiceError && <p role="alert" className="text-sm text-red-800">{choiceError}</p>}
                </div>
              )}
            </section>
          )}

          {(state.decisions?.length ?? 0) > 0 && (
            <section className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <h3 className="text-sm font-bold text-stone-950">Your decisions</h3>
              <ul className="mt-2 space-y-2">
                {(state.decisions ?? []).map((entry, index) => (
                  <li key={index} className="flex items-start justify-between gap-2 text-sm text-stone-700">
                    <span className="min-w-0">
                      {entry.quantity} {entry.kind === "crate" ? crateName.get(entry.returnedType) ?? entry.returnedType : entry.returnedType} {entry.kind === "crate" ? "empty crates" : "empty bottles"}
                      {entry.decision === "hold" ? " kept separately · correct type still owed" : " accepted instead · reduces empty returns still owed"}
                    </span>
                    <button type="button" className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 font-semibold text-emerald-900"
                      onClick={() => update({ emptiesV2: { ...state, decisions: state.decisions?.filter((_, i) => i !== index) } })}>
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
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

      {result && state.mode === "actual" && actualHasException && (crateIssues.length > 0 || result.swaps.length > 0 || hasUnmatchedSaleEmpties(result) || depositBlocked) && (
        <details
          open={depositBlocked}
          className="rounded-lg border border-stone-200 bg-white p-4"
        >
          <summary className="cursor-pointer py-1 font-semibold text-emerald-900">
            {depositBlocked ? "Return details · Deposit requires attention" : "See detailed empty-return breakdown"}
          </summary>

          {result.swaps.map((swap) => (
            <p key={`${swap.owedCrateTypeId}:${swap.returnedCrateTypeId}`}>
              {swap.quantity}{" "}
              {crateName.get(swap.returnedCrateTypeId) ?? "returned empty crate"}{" "}
              {swap.quantity === 1 ? "empty crate" : "empty crates"} accepted for{" "}
              {crateName.get(swap.owedCrateTypeId) ?? "the expected empty crate"}.
            </p>
          ))}

          {!shortages.length ? (
            <p className="mt-2 text-emerald-900">
              No additional missing empties from this sale.
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
              <p className="font-medium">Different empty crates to check</p>
              {crateIssues.map((issue) => {
                const returnedName =
                  crateName.get(issue.returnedCrateTypeId) ?? "Returned empty crate";
                const owedName = issue.owedCrateTypeId
                  ? (crateName.get(issue.owedCrateTypeId) ??
                    "the expected empty crate")
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
                      {issue.matchingBottlesNeeded ?? 0} matching empty bottles came
                      back.
                    </p>
                  );
                return (
                  <p className="text-stone-700" key={issue.returnedCrateTypeId}>
                    {issue.quantity} {issue.quantity === 1 ? "empty crate" : "empty crates"}{" "}
                    of {returnedName} came back, but{" "}
                    {issue.quantity === 1 ? "it did" : "they did"} not settle an
                    empty crate in this sale.
                  </p>
                );
              })}
            </div>
          )}

          {Object.keys(result.unmatchedBottles).length > 0 && (
            <div className="mt-4">
              <p className="font-medium">Other empty bottles that came back</p>
              {Object.entries(result.unmatchedBottles).map(
                ([type, quantity]) => (
                  <p key={type}>
                    {type} · {quantity}
                  </p>
                ),
              )}
            </div>
          )}

          {hasUnmatchedSaleEmpties(result) && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-amber-950">Some different empties still need attention above. When they belong to another sale, choose “Leave out of this sale” instead of applying them here.</p>}
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
              This customer requires a deposit for the missing empty crates or empty bottles. The
              prices are configured, but collecting the refundable deposit in
              this sale is not enabled yet.
            </p>
          )}
        </details>
      )}

      {state.mode === "actual" && !actualHasException && !hasFieldErrors && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
          These numbers still match what was expected. If everything came back correctly, choose “Yes, all empty returns received” above.
        </p>
      )}

      {result && hasUnmatchedSaleEmpties(result) && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
          Resolve the different {unmatchedCrateTypes.length ? "empty crates" : "empty bottles"} above before payment. Your sale is still saved as a draft.
        </p>
      )}
      <div className="sale-sticky-actions sticky z-10 -mx-4 flex items-center gap-3 border-t border-stone-200 bg-background px-4 pb-4 pt-3 sm:mx-0 sm:px-0">
        <button
          type="button"
          className="secondary min-h-12 shrink-0 px-4"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="primary min-w-0 flex-1"
          disabled={
            hasFieldErrors || !result || (state.mode === "exact" && !exactConfirmed) || (state.mode === "actual" && !actualHasException) || hasUnmatchedSaleEmpties(result) || Boolean(error) || depositBlocked
          }
          onClick={() => {
            if (result) update(paymentStepAfterEmpties(draft, result));
          }}
        >
          Next: Enter payment
        </button>
      </div>
    </>
  );
}
