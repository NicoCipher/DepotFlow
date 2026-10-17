"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A route fallback must never spin forever without a useful recovery action.
 * No invented percentages or fake "connected" statuses: a slow network
 * request can be pending even when the page itself is healthy.
 */
export function SlowPageAction({ context }: { context: "home" | "sale" | "page" }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!slow) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
      <p className="min-w-0 flex-1 text-amber-950" role="status">
        {context === "sale"
          ? "Taking longer than expected to open Record Sale. Your saved drafts stay on this device."
          : "Taking longer than expected. Check your connection or try again."}
      </p>
      <button
        type="button"
        className="secondary min-h-11 shrink-0 border-amber-300 bg-white px-4 text-sm"
        onClick={() => {
          setRetrying(true);
          router.refresh();
        }}
        disabled={retrying}
      >
        {retrying ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}
