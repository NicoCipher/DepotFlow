import { SlowPageAction } from "@/components/slow-page-action";

/** The checkout must look like checkout immediately, not a landing page or
 * a collection of giant empty blocks. It displays no guessed customer data. */
export default function LoadingRecordSale() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="border-b border-stone-200 pb-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-stone-950">
          Record sale
        </h1>
        <div role="status" className="mt-2 flex items-start gap-2 text-sm text-stone-600">
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-700 motion-safe:animate-pulse" />
          Checking customers, drinks and prices…
        </div>
      </header>

      <div className="flex items-center gap-2 text-xs font-semibold text-stone-600"
        aria-label="Sale steps: Customer, Drinks, Empties, Payment, Review">
        <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-900">1 Customer</span>
        <span aria-hidden="true">›</span>
        <span>2 Drinks</span>
        <span aria-hidden="true">›</span>
        <span>Payment</span>
      </div>

      <section aria-label="Preparing customer search" className="space-y-3">
        <h2 className="text-lg font-bold text-stone-900">Find a customer</h2>
        <div aria-hidden="true" className="space-y-3">
          <div className="h-12 rounded-xl border border-stone-200 bg-stone-100/70 motion-safe:animate-pulse" />
          <div className="flex h-15 items-center gap-3 rounded-xl border border-stone-200 bg-white px-3">
            <span className="size-9 shrink-0 rounded-full bg-stone-100 motion-safe:animate-pulse" />
            <div className="flex-1 space-y-2">
              <span className="block h-3 w-32 max-w-full rounded bg-stone-100 motion-safe:animate-pulse" />
              <span className="block h-2.5 w-20 rounded bg-stone-100 motion-safe:animate-pulse" />
            </div>
          </div>
          <div className="flex h-15 items-center gap-3 rounded-xl border border-stone-200 bg-white px-3">
            <span className="size-9 shrink-0 rounded-full bg-stone-100 motion-safe:animate-pulse" />
            <div className="flex-1 space-y-2">
              <span className="block h-3 w-28 max-w-full rounded bg-stone-100 motion-safe:animate-pulse" />
              <span className="block h-2.5 w-24 rounded bg-stone-100 motion-safe:animate-pulse" />
            </div>
          </div>
        </div>
      </section>
      <SlowPageAction context="sale" />
    </div>
  );
}
