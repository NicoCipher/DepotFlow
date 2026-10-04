"use client";
import Link from "next/link";
import { useSaleDrafts } from "./sale-draft-session";

export function PausedSalesLink({
  ownerId,
  prominent = false,
}: {
  ownerId: string;
  prominent?: boolean;
}) {
  const { state } = useSaleDrafts(ownerId);
  if (!state.paused.length) return null;

  if (prominent) {
    return (
      <Link
        className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
        href="/record-sale/paused"
      >
        <span>
          <strong className="block text-amber-950">Paused sales</strong>
          <small className="text-amber-900">
            {state.paused.length} unfinished {state.paused.length === 1 ? "sale" : "sales"}
          </small>
        </span>
        <strong className="shrink-0 text-amber-950">Resume →</strong>
      </Link>
    );
  }

  return (
    <Link className="quiet-link block" href="/record-sale/paused">
      Paused sales · {state.paused.length}
    </Link>
  );
}
