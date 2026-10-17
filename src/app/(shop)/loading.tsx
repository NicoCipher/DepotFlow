"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SlowPageAction } from "@/components/slow-page-action";

function PlaceholderLine({ wide = false }: { wide?: boolean }) {
  return (
    <span aria-hidden="true"
      className={`block h-3 rounded-full bg-stone-200/80 motion-safe:animate-pulse ${wide ? "w-36" : "w-24"}`} />
  );
}

/** All shop routes share this fallback, so never pretend to show real figures.
 * The Home fallback exposes the real next action immediately. */
export default function Loading() {
  const home = usePathname() === "/";
  if (!home) {
    return (
      <div className="mx-auto w-full max-w-xl py-1">
        <div role="status" className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-emerald-700 motion-safe:animate-pulse" />
          Opening page…
        </div>
        <div className="mt-5 space-y-4" aria-hidden="true">
          <PlaceholderLine wide />
          <div className="h-12 rounded-xl border border-stone-200 bg-stone-100/60" />
          <PlaceholderLine />
        </div>
        <SlowPageAction context="page" />
      </div>
    );
  }

  return (
    <section aria-labelledby="home-loading-heading" className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <h1 id="home-loading-heading" className="text-2xl font-extrabold tracking-tight text-stone-950">
          Your shop today
        </h1>
        <p role="status" className="mt-1 flex items-center gap-2 text-sm text-stone-600">
          <span aria-hidden="true" className="size-2 rounded-full bg-emerald-700 motion-safe:animate-pulse" />
          Getting today&apos;s figures…
        </p>
      </div>

      {/* The most-used task works even while the dashboard totals load. */}
      <Link href="/record-sale"
        className="flex min-h-24 items-center justify-between gap-4 rounded-2xl bg-emerald-950 px-5 py-4 text-white focus-visible:outline-emerald-700">
        <span className="min-w-0">
          <span className="block text-xs font-medium text-emerald-100">Ready to serve a customer?</span>
          <span className="mt-1 block text-xl font-bold">Record a sale</span>
        </span>
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/15 text-2xl">
          →
        </span>
      </Link>

      <div className="border-t border-stone-200 pt-4">
        <p className="text-sm font-semibold text-stone-900">Today&apos;s money</p>
        <div className="mt-3 grid grid-cols-2 gap-3" aria-hidden="true">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">Money received</p>
            <div className="mt-3 h-5 w-28 max-w-full rounded-md bg-stone-100 motion-safe:animate-pulse" />
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">Sales value</p>
            <div className="mt-3 h-5 w-28 max-w-full rounded-md bg-stone-100 motion-safe:animate-pulse" />
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-500">Totals appear when the latest records are ready.</p>
      </div>
      <SlowPageAction context="home" />
    </section>
  );
}
