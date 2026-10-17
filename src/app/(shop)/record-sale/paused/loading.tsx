import { SlowPageAction } from "@/components/slow-page-action";

/** The paused-sales route has a different job from a new sale. Avoid showing
 * "Find a customer" while restoring already parked work. */
export default function LoadingPausedSales() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-sm font-semibold text-emerald-800">Record sale</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-stone-950">Paused sales</h1>
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-stone-600">
          <span aria-hidden="true" className="size-2 rounded-full bg-emerald-700 motion-safe:animate-pulse" />
          Checking latest prices for your saved sales…
        </p>
      </header>
      <div className="space-y-2" aria-hidden="true">
        <div className="flex min-h-20 items-center justify-between rounded-xl border border-stone-200 bg-white p-4">
          <div className="space-y-2">
            <div className="h-3 w-32 rounded bg-stone-100 motion-safe:animate-pulse" />
            <div className="h-2.5 w-20 rounded bg-stone-100 motion-safe:animate-pulse" />
          </div>
          <div className="h-4 w-16 rounded bg-stone-100 motion-safe:animate-pulse" />
        </div>
        <div className="flex min-h-20 items-center justify-between rounded-xl border border-stone-200 bg-white p-4">
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-stone-100 motion-safe:animate-pulse" />
            <div className="h-2.5 w-28 rounded bg-stone-100 motion-safe:animate-pulse" />
          </div>
          <div className="h-4 w-16 rounded bg-stone-100 motion-safe:animate-pulse" />
        </div>
      </div>
      <SlowPageAction context="page" />
    </div>
  );
}
