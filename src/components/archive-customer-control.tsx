"use client";

import { useTransition } from "react";
import {
  archiveCustomer,
  restoreCustomer,
} from "@/app/(shop)/customers/actions";

export function ArchiveCustomerControl({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  if (archived)
    return (
      <div className="mt-10 border-t border-stone-300 pt-6">
        <form
          action={() => startTransition(() => restoreCustomer(id))}
        >
          <button className="secondary w-full" disabled={pending}>
            {pending ? "Restoring…" : "Restore Customer"}
          </button>
        </form>
      </div>
    );
  return (
    <div className="mt-10 border-t border-stone-300 pt-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            window.confirm(
              "Archive this customer?\nThey will no longer appear when recording a new sale. Their sales, payments and balances will stay.",
            )
          )
            startTransition(() => archiveCustomer(id));
        }}
      >
        <button className="secondary w-full" disabled={pending}>
          {pending ? "Archiving…" : "Archive Customer"}
        </button>
      </form>
    </div>
  );
}
