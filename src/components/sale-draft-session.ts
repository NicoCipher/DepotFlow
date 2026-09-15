"use client";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  emptySaleDraft,
  readSaleDraft,
  type SaleDraft,
} from "@/domain/sale-builder";
import {
  emptySaleDrafts,
  readSaleDrafts,
  updateActiveSale,
  parkActiveSale,
  resumeSale,
  cancelSale,
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
              id: `imported-${ownerId}`,
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
        localStorage.setItem(key, JSON.stringify(next));
        try {
          sessionStorage.removeItem(previousKey);
        } catch {
          /* New storage is already persisted. */
        }
        window.dispatchEvent(new Event(eventName));
      };
      if (navigator.locks) await navigator.locks.request(key, write);
      else write();
      setError("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.startsWith("The active")
          ? cause.message
          : "Could not update the draft on this device. Keep this page open and try again.",
      );
      return false;
    }
  }
  return {
    state: state ?? emptySaleDrafts,
    draft: state.active?.draft ?? emptySaleDraft,
    error,
    update: (patch: Partial<SaleDraft>) =>
      mutate((current) =>
        updateActiveSale(current, activeId, patch, crypto.randomUUID()),
      ),
    park: () =>
      mutate((current) =>
        parkActiveSale(current, activeId, new Date().toISOString()),
      ),
    resume: (id: string) =>
      mutate((current) => resumeSale(current, id, new Date().toISOString())),
    cancel: (id: string) => mutate((current) => cancelSale(current, id)),
  };
}
