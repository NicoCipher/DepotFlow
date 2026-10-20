import { formatNaira } from "@/domain/products";
import {
  canPresentOwnerSignoff,
  openingChecklist,
  type OpeningReadinessSnapshot,
} from "@/domain/opening-readiness";

/** Presentation only. Mount behind future tenant-aware owner authorization.
 * No premature sign-off button or production-activation action is provided.
 */
export function OnboardingOpeningReview({
  snapshot,
}: {
  snapshot: OpeningReadinessSnapshot;
}) {
  const checklist = openingChecklist(snapshot);
  const needsWork = checklist.filter((step) => step.status === "action").length;
  const s = snapshot.customerOpening;
  const canReview = canPresentOwnerSignoff(snapshot);
  return (
    <section className="mx-auto w-full max-w-2xl space-y-4 pb-8">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          Depot setup / Owner review
        </p>
        <h1 className="text-2xl font-extrabold leading-tight text-stone-950">
          Check your starting records
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          {snapshot.profile?.name ?? "This depot"} · These records existed before
          DepotFlow. Recording them must not create a sale or payment.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3">
        <span className="text-sm font-semibold text-stone-900">
          {canReview ? "Ready for owner review" : "Setup needs checking"}
        </span>
        <span className="text-xs font-medium text-stone-600">
          {needsWork ? `${needsWork} items need attention` : "Final owner confirmation required"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2" aria-label="Starting financial balances">
        <section className="rounded-2xl bg-stone-100 p-3">
          <h2 className="text-xs font-medium leading-5 text-stone-600">
            Customers owe the depot
          </h2>
          <p className="mt-1 break-words text-xl font-extrabold tabular-nums text-stone-950">
            {formatNaira(s.historicalDebtNaira)}
          </p>
        </section>
        <section className="rounded-2xl bg-stone-100 p-3">
          <h2 className="text-xs font-medium leading-5 text-stone-600">
            Refundable deposits held
          </h2>
          <p className="mt-1 break-words text-xl font-extrabold tabular-nums text-stone-950">
            {formatNaira(s.refundableDepositsHeldNaira)}
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="text-base font-bold text-stone-950">
          Empty containers customers still owe
        </h2>
        <p className="mt-1 text-xs leading-5 text-stone-600">
          These are outside the depot, not empties currently in stock.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <p><span className="block text-stone-600">Empty crates owed</span>
            <strong className="text-lg tabular-nums">{s.customerCratesOwed}</strong></p>
          <p><span className="block text-stone-600">Empty bottles owed</span>
            <strong className="text-lg tabular-nums">{s.customerBottlesOwed}</strong></p>
        </div>
      </section>

      <section aria-labelledby="opening-checklist">
        <h2 id="opening-checklist" className="mb-2 text-base font-bold text-stone-950">
          Setup checklist
        </h2>
        <ol className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white px-4">
          {checklist.map((item, index) => (
            <li className="flex items-start gap-3 py-3" key={item.id}>
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-bold text-stone-800">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-stone-950">{item.label}</h3>
                  <span className="text-xs font-semibold text-stone-600">
                    {item.status === "done" ? "Recorded" : item.status === "confirm" ? "Confirm" : "Needs attention"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-5 text-stone-600">
                  {item.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-xs leading-5 text-stone-600">
        This page is an opening-record review, not a Start Operations control.
        Depot activation and live checkout stay unavailable until the full
        multi-business release is verified.
      </p>
    </section>
  );
}
