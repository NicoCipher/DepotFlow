"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  activateBusiness,
  type BusinessActivationState,
} from "@/app/businesses/[businessId]/opening/actions";

const initial: BusinessActivationState = { message: "", activated: false };

export function OnboardingActivationForm({
  businessId, reviewToken, requestId,
}: {
  businessId: string;
  reviewToken: string;
  requestId: string;
}) {
  const [stableRequestId] = useState(requestId);
  const [state, action, pending] = useActionState(activateBusiness, initial);
  const router = useRouter();

  useEffect(() => {
    if (state.activated) router.replace("/businesses");
  }, [state.activated, router]);

  return (
    <section className="rounded-2xl border border-emerald-900 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-extrabold text-stone-950">Start this depot</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        The owner review is saved. Activation closes opening setup and
        switches this depot to its active operating state. The database checks
        the saved review and all current opening records again before changing status.
      </p>
      <form action={action} className="mt-4 space-y-3">
        <input type="hidden" name="business_id" value={businessId} />
        <input type="hidden" name="request_id" value={stableRequestId} />
        <input type="hidden" name="review_token" value={reviewToken} />
        {state.message && (
          <p role={state.activated ? "status" : "alert"}
            className="rounded-xl bg-stone-100 p-3 text-sm">{state.message}</p>
        )}
        {!state.activated && (
          <button type="submit" disabled={pending}
            className="primary min-h-12 w-full disabled:opacity-50">
            {pending ? "Checking opening records…" : "Activate depot"}
          </button>
        )}
      </form>
    </section>
  );
}
