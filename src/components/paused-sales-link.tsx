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
        className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
        href="/record-sale/paused"
      >
        <span className="font-semibold text-amber-950">
          Paused sales <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-950">{state.paused.length}</span>
        </span>
        <span className="font-bold text-amber-950">Resume →</span>
      </Link>
    );
  }

  return (
    <Link className="quiet-link block" href="/record-sale/paused">
      Paused sales · {state.paused.length}
    </Link>
  );
}
