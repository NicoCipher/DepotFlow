"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { readSaleDraft, type SaleDraft } from "@/domain/sale-builder";
const memory = new Map<string, string>();
const eventName = "depotflow-sale-draft";
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}
const serverSnapshot = () => "";
export function useSaleDraft(ownerId: string) {
  const key = `depotflow:sale-builder:v1:${ownerId}`;
  const getSnapshot = useCallback(() => {
    try {
      return memory.get(key) ?? sessionStorage.getItem(key) ?? "";
    } catch {
      return memory.get(key) ?? "";
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const draft = useMemo(() => readSaleDraft(raw), [raw]);
  function update(patch: Partial<SaleDraft>) {
    const value = JSON.stringify({ ...readSaleDraft(getSnapshot()), ...patch });
    memory.set(key, value);
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* Keep the draft in memory if tab storage is unavailable. */
    }
    window.dispatchEvent(new Event(eventName));
  }
  return [draft, update] as const;
}
