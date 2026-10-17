"use client";

import { useState } from "react";
import { SaleIcon } from "./sale-icon";
import { formatNaira } from "@/domain/products";
import {
  emptyMultiAmounts, multiPaymentFromReceived, paymentMethods,
  type MultiMethodAmounts,
} from "@/domain/multi-tenders";
import type { SaleTenderMethod } from "@/domain/sale-tenders";
import type { SaleDraft } from "@/domain/sale-builder";

const labels: Record<SaleTenderMethod, string> = {
  cash: "Cash", transfer: "Transfer", pos: "POS",
};

export function MultiPaymentPanel({
  draft, saleTotal, oldDebt, oldDebtError, onRetryDebt, update, onUseSingle,
}: {
  draft: SaleDraft;
  saleTotal: number | undefined;
  oldDebt: number | null;
  oldDebtError: string;
  onRetryDebt: () => void;
  update: (patch: Partial<SaleDraft>) => void;
  onUseSingle: (method: SaleTenderMethod | "") => void;
}) {
  const [removeMethod, setRemoveMethod] = useState<SaleTenderMethod | null>(null);
  const [payPrevious, setPayPrevious] = useState(Number(draft.oldDebtPaid) > 0);
  const [confirmStopDebt, setConfirmStopDebt] = useState(false);
  const [expandAllocation, setExpandAllocation] = useState(Number(draft.oldDebtPaid) > 0);
  const methods = draft.multiMethods;
  const preview = multiPaymentFromReceived({
    methods, received: draft.multiReceived, towardOldDebt: draft.multiOldDebt,
    saleTotal, verifiedOldDebt: oldDebt,
  });
  const received = methods.reduce((sum, m) => sum + (Number(draft.multiReceived[m]) || 0), 0);
  const payingOld = methods.reduce((sum, m) => sum + (Number(draft.multiOldDebt[m]) || 0), 0);

  function change(methodsNext: SaleTenderMethod[], amounts: MultiMethodAmounts, debt: MultiMethodAmounts) {
    const entry = multiPaymentFromReceived({
      methods: methodsNext, received: amounts, towardOldDebt: debt,
      saleTotal, verifiedOldDebt: oldDebt,
    });
    update({
      multiMethods: methodsNext, multiReceived: amounts, multiOldDebt: debt,
      // Invalid inputs stay editable, but cannot produce a new financial
      // allocation or advance to Review.
      ...(entry.salePaid !== null && entry.oldDebtPaid !== null
        ? { paid: String(entry.salePaid), oldDebtPaid: String(entry.oldDebtPaid) }
        : {}),
    });
  }

  function toggle(method: SaleTenderMethod) {
    if (!methods.includes(method)) {
      change([...methods, method], draft.multiReceived, draft.multiOldDebt);
      return;
    }
    if (draft.multiReceived[method] !== "0" && Number(draft.multiReceived[method]) > 0) {
      setRemoveMethod(method);
      return;
    }
    const nextAmounts = { ...draft.multiReceived, [method]: "0" };
    const nextDebt = { ...draft.multiOldDebt, [method]: "0" };
    change(methods.filter(m => m !== method), nextAmounts, nextDebt);
  }

  function removeConfirmed() {
    if (!removeMethod) return;
    const method = removeMethod;
    setRemoveMethod(null);
    change(methods.filter(m => m !== method),
      { ...draft.multiReceived, [method]: "0" },
      { ...draft.multiOldDebt, [method]: "0" });
  }

  function clearOldDebt() {
    change(methods, draft.multiReceived, emptyMultiAmounts());
    setPayPrevious(false);
    setConfirmStopDebt(false);
  }

  const singleMethod = methods.filter(m => Number(draft.multiReceived[m]) > 0);
  return (
    <div id="sale-split-payment" tabIndex={-1} className="mt-4 border-t border-stone-100 pt-3">
      <p className="mb-2 text-sm font-semibold text-stone-900">Select payment methods</p>
      <div role="group" aria-label="Select methods received" className="grid grid-cols-3 gap-2">
        {paymentMethods.map(method => {
          const active = methods.includes(method);
          return (
            <button key={method} type="button" aria-pressed={active}
              onClick={() => toggle(method)}
              className={active
                ? "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 border-emerald-800 bg-emerald-50 p-2 text-sm font-semibold text-emerald-950"
                : "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border border-stone-200 bg-stone-50 p-2 text-sm font-semibold text-stone-700"}>
              <SaleIcon name={method} className="h-5 w-5" />
              {labels[method]}
              {active && <span className="text-xs text-emerald-800" aria-hidden="true">✓ Selected</span>}
            </button>
          );
        })}
      </div>
      {removeMethod && (
        <div role="group" aria-label="Confirm removing payment method" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>Remove {labels[removeMethod]}? Its entered amount and previous-debt allocation will be cleared.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="secondary min-h-11" type="button" onClick={() => setRemoveMethod(null)}>Keep</button>
            <button className="primary min-h-11" type="button" onClick={removeConfirmed}>Remove method</button>
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {methods.map(method => (
          <div className="min-w-0" key={method}>
            <label htmlFor={`sale-multi-${method}`} className="mb-1 text-xs font-semibold">{labels[method]} received (₦)</label>
            <input id={`sale-multi-${method}`} inputMode="numeric" pattern="[0-9]+" maxLength={12}
              value={draft.multiReceived[method]}
              onFocus={event => event.currentTarget.select()}
              onChange={event => change(methods,
                { ...draft.multiReceived, [method]: event.target.value }, draft.multiOldDebt)} />
          </div>
        ))}
      </div>
      {methods.length === 0 && <p className="mt-2 text-sm text-stone-600">Choose Cash, Transfer, POS, or record the sale as pay later.</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-stone-600">Total received</span>
        <strong className="text-lg font-bold tabular-nums">{Number.isSafeInteger(received) && received >= 0 ? formatNaira(received) : "Check amounts"}</strong>
      </div>
      {preview.issue && <p role="alert" className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">{preview.issue}</p>}
      {singleMethod.length === 1 && methods.filter(m => Number(draft.multiReceived[m]) > 0).length === 1 && (
        <button type="button" className="mt-2 min-h-11 text-sm font-semibold text-emerald-900 underline underline-offset-2"
          onClick={() => onUseSingle(singleMethod[0])}>Only {labels[singleMethod[0]]} received? Use one method</button>
      )}
      {received === 0 && payingOld === 0 && (
        <button type="button" className="mt-2 min-h-11 text-sm font-semibold text-emerald-900 underline underline-offset-2"
          onClick={() => onUseSingle("")}>No payment received? Record as pay later</button>
      )}

      <div id="sale-previous-debt" tabIndex={-1} className="mt-4 border-t border-stone-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-stone-900">Previous money owed</span>
          <strong className="tabular-nums">{oldDebt === null ? "Checking…" : formatNaira(oldDebt)}</strong>
        </div>
        {oldDebtError && (
          <div role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 p-2 text-sm">
            <span>{oldDebtError}</span>
            <button type="button" className="secondary min-h-11 shrink-0 px-3" onClick={onRetryDebt}>Retry</button>
          </div>
        )}
        {oldDebt !== null && oldDebt > 0 && (
          <>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold text-stone-800">
              <input type="checkbox" className="!h-5 !w-5 !min-w-5 !rounded" checked={payPrevious || payingOld > 0}
                onChange={event => {
                  if (event.target.checked) { setPayPrevious(true); setExpandAllocation(true); }
                  else if (payingOld > 0) setConfirmStopDebt(true);
                  else setPayPrevious(false);
                }} />
              Pay previous debt too
            </label>
            {confirmStopDebt && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                <p>Remove the recorded previous-debt payment? The received amounts will remain, so you may need to adjust them.</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className="secondary min-h-11" onClick={() => setConfirmStopDebt(false)}>Keep payment</button>
                  <button type="button" className="primary min-h-11" onClick={clearOldDebt}>Remove allocation</button>
                </div>
              </div>
            )}
            {(payPrevious || payingOld > 0) && (
              <div className="mt-2 rounded-xl border border-stone-200 bg-stone-50/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900">Paying previous debt</p>
                    <p className="text-xs text-stone-600">Only money received can clear older debt</p>
                  </div>
                  <strong className="tabular-nums">{Number.isSafeInteger(payingOld) ? formatNaira(payingOld) : "—"}</strong>
                </div>
                <button type="button" aria-expanded={expandAllocation}
                  className="mt-2 min-h-10 text-sm font-semibold text-emerald-900 underline underline-offset-2"
                  onClick={() => setExpandAllocation(!expandAllocation)}>
                  {expandAllocation ? "Hide method allocation" : "Adjust which method pays old debt"}
                </button>
                {expandAllocation && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {methods.map(method => (
                      <div className="min-w-0" key={method}>
                        <label className="mb-1 text-xs" htmlFor={`sale-multi-debt-${method}`}>{labels[method]} for old debt (₦)</label>
                        <input id={`sale-multi-debt-${method}`} inputMode="numeric" pattern="[0-9]+" maxLength={12}
                          value={draft.multiOldDebt[method]}
                          onFocus={event => event.currentTarget.select()}
                          onChange={event => change(methods, draft.multiReceived,
                            { ...draft.multiOldDebt, [method]: event.target.value })} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {oldDebt === 0 && payingOld > 0 && (
          <p role="alert" className="mt-2 text-sm text-amber-950">Previous debt has been cleared. Set its allocations to ₦0 to continue.</p>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
        <div>
          <p className="text-xs text-stone-600">Paid for today&apos;s sale</p>
          <p className="text-base font-bold tabular-nums">{preview.salePaid !== null ? formatNaira(preview.salePaid) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-stone-600">Paid toward old debt</p>
          <p className="text-base font-bold tabular-nums">{preview.oldDebtPaid !== null ? formatNaira(preview.oldDebtPaid) : "—"}</p>
        </div>
        {preview.salePaid !== null && saleTotal !== undefined && (
          <div>
            <p className="text-xs text-stone-600">Unpaid today</p>
            <p className="font-semibold tabular-nums">{formatNaira(saleTotal - preview.salePaid)}</p>
          </div>
        )}
        {preview.oldDebtPaid !== null && oldDebt !== null && (
          <div>
            <p className="text-xs text-stone-600">Previous debt left</p>
            <p className="font-semibold tabular-nums">{formatNaira(oldDebt - preview.oldDebtPaid)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
