"use client";
import Link from "next/link";
import { useSaleDrafts } from "./sale-draft-session";
export function PausedSalesLink({ ownerId }: { ownerId: string }) {
  const { state } = useSaleDrafts(ownerId);
  return state.paused.length ? (
    <Link className="quiet-link block" href="/record-sale/paused">
      Paused sales · {state.paused.length}
    </Link>
  ) : null;
}
