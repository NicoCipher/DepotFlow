"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SaleIcon } from "@/components/sale-icon";
import { useSaleDrafts } from "./sale-draft-session";
import { revalidateSaleDraft, type SaleCatalog } from "@/domain/sale-builder";
import { hasSaleWork } from "@/domain/sale-drafts";
import { formatNaira } from "@/domain/products";
import { refreshSaleCatalog } from "@/app/(shop)/record-sale/actions";
import {
  saleNetworkMessage,
  saleSessionExpiredMessage,
} from "@/domain/sale-errors";
export function PausedSales({
  ownerId,
  initialCatalog,
}: {
  ownerId: string;
  initialCatalog: SaleCatalog;
}) {
  const sales = useSaleDrafts(ownerId);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [message, setMessage] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const cancelTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const [sessionExpired, setSessionExpired] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (sessionExpired)
    return (
      <div className="space-y-5">
        <h1>Paused Sales</h1>
        <div
          role="alert"
          className="border-l-4 border-amber-700 pl-3 text-amber-950"
        >
          <p className="font-semibold">{saleSessionExpiredMessage}</p>
          <p className="mt-1 text-sm">
            Your paused sales are saved on this device.
          </p>
        </div>
        <Link
          href="/sign-in?next=/record-sale/paused"
          className="primary block w-full text-center"
        >
          Sign in again
        </Link>
      </div>
    );
  return (
    <fieldset disabled={pending} className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-emerald-800">Record sale</p>
        <h1>Paused sales</h1>
        <p className="mt-2 text-sm text-stone-600">Pick up where you stopped. Each sale is kept on this device.</p>
      </div>
      {sales.error && <p role="alert" className="text-red-800">{sales.error}</p>}
      {message && <p role="alert" className="text-red-800">{message}</p>}
      {sales.state.active && hasSaleWork(sales.draft) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          You are already recording another sale. Resuming one of these will park the current sale first.
        </p>
      )}
      {!sales.state.paused.length && (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
            <SaleIcon name="pause" />
          </div>
          <h2 className="mt-3 font-bold">No paused sales</h2>
          <p className="mt-1 text-sm text-stone-600">Sales you park will appear here.</p>
        </div>
      )}
      <ul className="grid gap-3">
        {sales.state.paused.map((entry) => {
          const check = revalidateSaleDraft(entry.draft, catalog);
          const customer = catalog.customers.find((c) => c.id === entry.draft.customerId);
          const confirm = confirmCancelId === entry.id;
          return (
            <li key={entry.id} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-bold text-stone-950">{customer?.name ?? "Choose customer"}</h2>
                  <p className="mt-1 text-sm text-stone-600">
                    {entry.draft.lines.length} {entry.draft.lines.length === 1 ? "drink" : "drinks"} ·
                    {" "}Paused <time dateTime={entry.pausedAt!}>
                      {new Date(entry.pausedAt!).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </time>
                  </p>
                </div>
                <strong className="shrink-0 text-lg font-bold tabular-nums text-emerald-950">
                  {check.total === undefined ? "Check" : formatNaira(check.total)}
                </strong>
              </div>
              {check.warnings.map((warning, index) => <p key={index} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{warning}</p>)}
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <button
                  type="button"
                  className="primary w-full gap-2"
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const response = await refreshSaleCatalog();
                        if ("error" in response) {
                          if (response.code === "session_expired") {
                            setSessionExpired(true);
                            setMessage(saleSessionExpiredMessage);
                          } else {
                            setMessage(response.error ?? saleNetworkMessage);
                          }
                          return;
                        }
                        setCatalog(response.catalog);
                        if (await sales.resume(entry.id)) {
                          router.push("/record-sale");
                          router.refresh();
                        }
                      } catch {
                        setMessage(saleNetworkMessage);
                      }
                    })
                  }
                >
                  <SaleIcon name="arrow" className="h-4 w-4" /> Resume sale
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-3 font-semibold text-red-800 hover:border-red-300 hover:bg-red-50"
                  aria-expanded={confirm}
                  ref={(button) => { cancelTriggers.current[entry.id] = button; }}
                  aria-controls={"paused-cancel-" + entry.id}
                  onClick={() => setConfirmCancelId(confirm ? null : entry.id)}
                >
                  <SaleIcon name="trash" className="h-4 w-4" /> Cancel sale
                </button>
              </div>
              {confirm && (
                <div id={"paused-cancel-" + entry.id} role="group" aria-label="Confirm cancellation" className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="font-bold text-red-950">Discard this paused sale?</p>
                  <p className="mt-1 text-sm text-red-900">All details saved in this unfinished sale will be lost.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button type="button" className="secondary w-full" onClick={() => {
                      cancelTriggers.current[entry.id]?.focus();
                      setConfirmCancelId(null);
                    }}>Keep sale</button>
                    <button type="button" className="min-h-12 rounded-lg bg-red-800 px-3 font-semibold text-white hover:bg-red-900" onClick={() => startTransition(async () => {
                      if (await sales.cancel(entry.id)) setConfirmCancelId(null);
                    })}>Yes, cancel sale</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Link className="secondary w-full" href="/record-sale">
        Back to Record Sale
      </Link>
    </fieldset>
  );
}
