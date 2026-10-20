"use client";

import { useActionState } from "react";
import {
  confirmOpeningReview,
  type OpeningReviewState,
} from "@/app/businesses/[businessId]/opening/actions";

const initial: OpeningReviewState = { message: "", recorded: false };

const statements = [
  {
    id: "stock_checked",
    text: "I checked the drinks, empty crates and empty bottles physically in this depot.",
  },
  {
    id: "customer_debts_checked",
    text: "I checked the old debts customers owe this depot.",
  },
  {
    id: "refundable_deposits_checked",
    text: "I checked refundable deposits held for customers separately from debt.",
  },
  {
    id: "customer_empties_checked",
    text: "I checked empty crates and bottles that customers still owe us.",
  },
  {
    id: "zero_history_checked",
    text: "I checked customers with no opening records and confirmed whether they have any old balance.",
  },
] as const;

export function OnboardingOwnerSignoffForm({
  businessId,
  businessName,
  reviewToken,
  requestId,
}: {
  businessId: string;
  businessName: string;
  reviewToken: string;
  requestId: string;
}) {
  const [state, action, pending] = useActionState(confirmOpeningReview, initial);
  return (
    <section className="rounded-2xl border border-stone-300 bg-white p-4 sm:p-5" aria-labelledby="owner-signoff-title">
      <h2 id="owner-signoff-title" className="text-lg font-extrabold text-stone-950">
        Confirm your opening records
      </h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Only the owner can record this acknowledgment. It will not start operations.
        If any figure is wrong, correct it before confirming.
      </p>
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="business_id" value={businessId} />
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="review_token" value={reviewToken} />
        <div className="space-y-3">
          {statements.map((statement) => (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-5 text-stone-800" key={statement.id}>
              <input
                type="checkbox"
                name={statement.id}
                required
                disabled={pending || state.recorded}
                className="mt-1 size-4 shrink-0 accent-emerald-800"
              />
              <span>{statement.text}</span>
            </label>
          ))}
        </div>
        <div>
          <label htmlFor="opening-confirm-business" className="block text-sm font-semibold text-stone-950">
            Type the exact business name to confirm
          </label>
          <p className="my-1 text-xs text-stone-600">{businessName}</p>
          <input
            id="opening-confirm-business"
            name="business_name"
            required
            maxLength={120}
            autoComplete="off"
            disabled={pending || state.recorded}
            placeholder="Business name"
            className="w-full"
          />
        </div>
        {state.message && (
          <p role="status" className="rounded-xl bg-stone-100 p-3 text-sm leading-6 text-stone-900">
            {state.message}
          </p>
        )}
        <button type="submit" className="primary min-h-12 w-full" disabled={pending || state.recorded}>
          {state.recorded ? "Review recorded" : pending ? "Checking and recording…" : "Record owner review"}
        </button>
      </form>
      <p className="mt-3 text-xs leading-5 text-stone-600">
        Recording this review does not activate the depot, change stock,
        collect payment or enable sales.
      </p>
    </section>
  );
}
