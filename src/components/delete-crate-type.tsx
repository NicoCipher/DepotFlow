"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteUnusedCrateType } from "@/app/(shop)/crate-types/actions";

export function DeleteCrateType({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className="quiet-link text-sm text-red-800"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Delete ${name}? This can only work if the crate type has never been used.`)) return;
          startTransition(async () => {
            setMessage("");
            try {
              const result = await deleteUnusedCrateType(id);
              if (result.deleted) {
                router.replace("/crate-types?deleted=1");
                router.refresh();
              } else setMessage(result.message ?? "Could not delete this crate. Try again.");
            } catch {
              setMessage("Could not confirm deletion. Check your connection and try again.");
            }
          });
        }}
      >
        {pending ? "Checking…" : "Delete unused crate"}
      </button>
      {message && <p role="alert" className="mt-2 text-sm text-red-800">{message}</p>}
    </>
  );
}
