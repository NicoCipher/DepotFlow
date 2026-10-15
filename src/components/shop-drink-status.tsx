"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setShopDrinkStatus } from "@/app/(shop)/products/actions";

export function ShopDrinkStatus({
  id, name, active, stock,
}: {
  id: string; name: string; active: boolean; stock: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  const remaining = stock === null
    ? "Its stock count is not yet recorded."
    : stock === 0 ? "It has no recorded bottles in stock."
      : `It still has ${stock} bottles recorded in stock. Their count is kept, not discarded.`;
  return (
    <section aria-label="Drink availability" className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-lg font-semibold">In your shop</h2>
      <p className="mt-1 text-sm text-stone-700">
        {active ? "Available to record in new sales." : "Removed from new sales. Its history and stock are kept."}
      </p>
      <p className="mt-2 text-sm text-stone-600">{remaining}</p>
      <button
        type="button"
        className={active ? "secondary mt-4 w-full" : "primary mt-4 w-full"}
        disabled={pending}
        onClick={() => {
          const confirmation = active
            ? `Remove ${name} from your shop?\n\nIt will no longer appear when recording new sales. ${remaining}\n\nPast sales, receipts and customer balances are kept. You can restore this drink later.`
            : `Restore ${name} to your shop?\n\nIt will be available for new sales again. Check its selling price and actual stock before the next sale.`;
          if (!window.confirm(confirmation)) return;
          setMessage("");
          startTransition(async () => {
            const result = await setShopDrinkStatus(id, !active, active);
            if (result.saved) {
              router.refresh();
            } else {
              setMessage(result.message ?? "Could not change this drink.");
            }
          });
        }}
      >
        {pending ? "Saving…" : active ? "Remove from shop" : "Restore to shop"}
      </button>
      {message && <p role="alert" className="mt-3 text-sm text-red-800">{message}</p>}
    </section>
  );
}
