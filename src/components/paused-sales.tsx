"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSaleDrafts } from "./sale-draft-session";
import { revalidateSaleDraft, type SaleCatalog } from "@/domain/sale-builder";
import { hasSaleWork } from "@/domain/sale-drafts";
import { formatNaira } from "@/domain/products";
import { loadSaleCatalog } from "@/app/(shop)/record-sale/actions";
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
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <fieldset disabled={pending} className="space-y-5">
      <h1>Paused Sales</h1>
      {sales.error && (
        <p role="alert" className="text-red-800">
          {sales.error}
        </p>
      )}
      {message && (
        <p role="alert" className="text-red-800">
          {message}
        </p>
      )}
      {sales.state.active && hasSaleWork(sales.draft) && (
        <p className="text-sm text-stone-600">
          Resuming a sale will park your current sale.
        </p>
      )}
      {!sales.state.paused.length && <p>No paused sales.</p>}
      <ul className="divide-y divide-stone-300">
        {sales.state.paused.map((entry) => {
          const check = revalidateSaleDraft(entry.draft, catalog);
          const customer = catalog.customers.find(
            (c) => c.id === entry.draft.customerId,
          );
          return (
            <li key={entry.id} className="space-y-3 py-5">
              <h2 className="text-xl font-semibold">
                {customer?.name ?? "Choose customer"}
              </h2>
              <p>
                {entry.draft.lines.length}{" "}
                {entry.draft.lines.length === 1 ? "drink" : "drinks"} ·{" "}
                {check.total === undefined
                  ? "Check stock and prices"
                  : formatNaira(check.total)}
              </p>
              <p className="text-sm text-stone-600">
                Paused{" "}
                <time dateTime={entry.pausedAt!}>
                  {new Date(entry.pausedAt!).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </p>
              {check.warnings.map((warning, index) => (
                <p key={index} className="text-sm text-amber-900">
                  {warning}
                </p>
              ))}
              <button
                className="primary w-full"
                onClick={() =>
                  startTransition(async () => {
                    try {
                      const fresh = await loadSaleCatalog();
                      setCatalog(fresh);
                      if (await sales.resume(entry.id)) {
                        router.push("/record-sale");
                        router.refresh();
                      }
                    } catch {
                      setMessage(
                        "Could not check current prices and stock. Your paused sale is still here. Try again.",
                      );
                    }
                  })
                }
              >
                Resume
              </button>
              <button
                className="quiet-link"
                onClick={() => {
                  if (
                    window.confirm(
                      "Cancel this unfinished sale? This cannot be undone.",
                    )
                  )
                    void sales.cancel(entry.id);
                }}
              >
                Cancel Sale
              </button>
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
