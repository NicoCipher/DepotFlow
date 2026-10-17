"use client";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { withBoundedSaleDraftLock } from "@/domain/sale-draft-lock";
import { transitionSaleToReview } from "@/domain/sale-review-transition";
import {
  emptySaleDraft,
  readSaleDraft,
  type SaleDraft,
} from "@/domain/sale-builder";
import {
  emptySaleDrafts,
  readSaleDrafts,
  updateActiveSale,
  selectSaleCustomer,
  parkActiveSale,
  resumeSale,
  cancelSale,
  completeSale,
  isSaleRequestId,
  replaceActiveSaleId,
  setActiveSaleSaveUncertain,
  recoverConfirmedUnsavedSplit,
  type SaleDrafts,
} from "@/domain/sale-drafts";
const eventName = "depotflow-sale-drafts";
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}
const serverSnapshot = () => "";
export function useSaleDrafts(ownerId: string) {
  const key = `depotflow:sale-drafts:v2:${ownerId}`;
  const previousKey = `depotflow:sale-builder:v1:${ownerId}`;
  const [error, setError] = useState("");
  const getSnapshot = useCallback(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return saved;
      const previous = readSaleDraft(sessionStorage.getItem(previousKey));
      return previous !== emptySaleDraft
        ? JSON.stringify({
            version: 2,
            active: {
              id: ownerId,
              draft: previous,
              pausedAt: null,
            },
            paused: [],
          })
        : "";
    } catch {
      return "";
    }
  }, [key, previousKey, ownerId]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const state = useMemo(() => readSaleDrafts(raw), [raw]);
  const activeId = state.active?.id ?? null;
  async function mutate(transform: (current: SaleDrafts) => SaleDrafts) {
    try {
      const write = () => {
        const current = readSaleDrafts(getSnapshot());
        const next = transform(current);
        // A successful storage call is not sufficient if the draft cannot
        // round-trip through the very parser used by the checkout screen.
        // Never claim Review opened when its persisted step is unreadable.
        const serialized = JSON.stringify(next);
        const restored = readSaleDrafts(serialized);
        if ((restored.active?.id ?? null) !== (next.active?.id ?? null) ||
            restored.active?.draft.step !== next.active?.draft.step ||
            restored.paused.length !== next.paused.length)
          throw new Error("The unfinished sale could not be verified on this device.");
        localStorage.setItem(key, serialized);
        if (localStorage.getItem(key) !== serialized)
          throw new Error("The unfinished sale was not saved on this device.");
        try {
          sessionStorage.removeItem(previousKey);
        } catch {
          /* New storage is already persisted. */
        }
        window.dispatchEvent(new Event(eventName));
      };
      if (navigator.locks) await withBoundedSaleDraftLock(navigator.locks, key, write);
      else write();
      setError("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error &&
        (cause.message.startsWith("The active") || cause.message.startsWith("The sale draft is busy"))
          ? cause.message
          : "Could not update the draft on this device. Keep this page open and try again.",
      );
      return false;
    }
  }
  async function ensureRequestId(expectedId: string) {
    if (isSaleRequestId(expectedId)) return expectedId;
    const requestId = crypto.randomUUID();
    const saved = await mutate((current) =>
      replaceActiveSaleId(current, expectedId, requestId),
    );
    return saved ? requestId : null;
  }
  return {
    state: state ?? emptySaleDrafts,
    draft: state.active?.draft ?? emptySaleDraft,
    error,
    update: (patch: Partial<SaleDraft>) =>
      mutate((current) =>
        updateActiveSale(current, activeId, patch, crypto.randomUUID()),
      ),
    // Review must commit only the payment/empties that the server checked.
    // This is a local draft step, NOT a sale or financial database write.
    enterReview: (
      expectedDraft: SaleDraft,
      reviewed: Pick<SaleDraft, "lines" | "businessDate">,
    ) => mutate((current) =>
      transitionSaleToReview(current, activeId, expectedDraft, reviewed, crypto.randomUUID()),
    ),
    selectCustomer: (expectedId: string | null, customerId: string) =>
      mutate((current) =>
        selectSaleCustomer(
          current,
          expectedId,
          customerId,
          crypto.randomUUID(),
        ),
      ),
    park: () =>
      mutate((current) =>
        parkActiveSale(current, activeId, new Date().toISOString()),
      ),
    resume: (id: string) =>
      mutate((current) => resumeSale(current, id, new Date().toISOString())),
    cancel: (id: string) => mutate((current) => cancelSale(current, id)),
    complete: (id: string) => mutate((current) => completeSale(current, id)),
    ensureRequestId,
    restartAfterConfirmedNonSave: async (expectedId: string) => {
      const newId = crypto.randomUUID();
      return mutate((current) => recoverConfirmedUnsavedSplit(current, expectedId, newId));
    },
    setSaveUncertain: (expectedId: string, value: boolean) =>
      mutate((current) =>
        setActiveSaleSaveUncertain(current, expectedId, value),
      ),
  };
}
