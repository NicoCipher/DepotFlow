import {
  emptySaleDraft,
  readSaleDraft,
  type SaleDraft,
} from "./sale-builder.ts";
export type StoredSaleDraft = {
  id: string;
  draft: SaleDraft;
  pausedAt: string | null;
  resumedAt?: string | null;
  saveUncertain?: boolean;
};
export type SaleDrafts = {
  version: 2;
  active: StoredSaleDraft | null;
  paused: StoredSaleDraft[];
};
export const emptySaleDrafts: SaleDrafts = {
  version: 2,
  active: null,
  paused: [],
};

export function isSaleRequestId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

export function replaceActiveSaleId(
  state: SaleDrafts,
  expectedId: string,
  requestId: string,
): SaleDrafts {
  if (state.active?.id !== expectedId)
    throw new Error("The active sale changed. Open it again before saving.");
  if (!isSaleRequestId(requestId))
    throw new Error("Could not prepare this sale for saving.");
  if (state.paused.some((entry) => entry.id === requestId))
    throw new Error("Could not prepare this sale for saving.");
  return {
    ...state,
    active: { ...state.active, id: requestId },
  };
}
export function setActiveSaleSaveUncertain(
  state: SaleDrafts,
  expectedId: string,
  saveUncertain: boolean,
): SaleDrafts {
  if (state.active?.id !== expectedId)
    throw new Error("The active sale changed. Open it again before saving.");
  return {
    ...state,
    active: { ...state.active, saveUncertain },
  };
}

export function hasSaleWork(draft: SaleDraft) {
  return Boolean(draft.customerId || draft.lines.length);
}
export function readSaleDrafts(raw: string | null): SaleDrafts {
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version !== 2 || !Array.isArray(data.paused))
      return emptySaleDrafts;
    const entries = [...(data.active ? [data.active] : []), ...data.paused];
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      return emptySaleDrafts;
    for (const entry of entries) {
      if (
        typeof entry.id !== "string" ||
        !entry.id ||
        readSaleDraft(JSON.stringify(entry.draft)) === emptySaleDraft
      )
        return emptySaleDrafts;
      if (
        entry !== data.active &&
        (typeof entry.pausedAt !== "string" ||
          !Number.isFinite(Date.parse(entry.pausedAt)))
      )
        return emptySaleDrafts;
    }
    return {
      version: 2,
      active: data.active
        ? {
            ...data.active,
            saveUncertain: data.active.saveUncertain === true,
            draft: cleanDraft(data.active.draft),
          }
        : null,
      paused: data.paused.map((entry: StoredSaleDraft) => ({
        ...entry,
        saveUncertain: entry.saveUncertain === true,
        draft: cleanDraft(entry.draft),
      })),
    };
  } catch {
    return emptySaleDrafts;
  }
}
// Keep customer identity only, never a typed phone/name search or contact record.
function cleanDraft(draft: SaleDraft): SaleDraft {
  return { ...draft, customerQuery: "" };
}
export function updateActiveSale(
  state: SaleDrafts,
  expectedId: string | null,
  patch: Partial<SaleDraft>,
  newId: string,
): SaleDrafts {
  if ((state.active?.id ?? null) !== expectedId)
    throw new Error("The active sale changed. Open it again before editing.");
  return {
    ...state,
    active: {
      id: expectedId ?? newId,
      pausedAt: null,
      resumedAt: state.active?.resumedAt ?? null,
      saveUncertain: state.active?.saveUncertain ?? false,
      draft: cleanDraft({
        ...(state.active?.draft ?? emptySaleDraft),
        ...patch,
      }),
    },
  };
}
export function parkActiveSale(
  state: SaleDrafts,
  expectedId: string | null,
  now: string,
): SaleDrafts {
  if ((state.active?.id ?? null) !== expectedId)
    throw new Error("The active sale changed. Open it again.");
  return {
    ...state,
    active: null,
    paused:
      state.active && hasSaleWork(state.active.draft)
        ? [...state.paused, { ...state.active, pausedAt: now }]
        : state.paused,
  };
}
export function resumeSale(
  state: SaleDrafts,
  id: string,
  now: string,
): SaleDrafts {
  const target = state.paused.find((entry) => entry.id === id);
  if (!target) throw new Error("This paused sale is no longer available.");
  const next = parkActiveSale(state, state.active?.id ?? null, now);
  return {
    ...next,
    active: { ...target, pausedAt: null, resumedAt: now },
    paused: next.paused.filter((entry) => entry.id !== id),
  };
}
export function cancelSale(state: SaleDrafts, id: string): SaleDrafts {
  return {
    ...state,
    active: state.active?.id === id ? null : state.active,
    paused: state.paused.filter((entry) => entry.id !== id),
  };
}
export function completeSale(state: SaleDrafts, id: string): SaleDrafts {
  if (state.active?.id !== id)
    throw new Error("The active sale changed. Open it again.");
  return { ...state, active: null };
}

/** Returning from customer creation changes only the customer and sale step. */
export function selectSaleCustomer(
  state: SaleDrafts,
  expectedId: string | null,
  customerId: string,
  newId: string,
) {
  return updateActiveSale(
    state,
    expectedId,
    { customerId, step: "drinks" },
    newId,
  );
}
