"use client";

import { useActionState, useState } from "react";
import { activateBusiness } from "@/app/businesses/[businessId]/opening/actions";

type ActivationState = { message: string };
const initial: ActivationState = { message: "" };

export function OnboardingActivationForm({
  businessId, reviewToken, requestId,
}: {
  businessId: string;
  reviewToken: string;
  requestId: string;
}) {
  const [stableRequestId] = useState(requestId);
  const [state, action, pending] = useActionState(
    async (_previous: ActivationState, formData: FormData) => {
      try {
        await activateBusiness(formData);
        return { message: "Activation completed." };
      } catch {
        return { message: "Activation was not confirmed. Reload the opening review and check the depot status before retrying." };
      }
    },
    initial,
  );

  return (
    <section className="rounded-2xl border border-emerald-900 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-extrabold text-stone-950">Start this depot</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        The owner review is saved. Activation will close opening setup and
        switch this depot to its active operating state. The database checks
        the saved review and all current opening records again before changing status.
      </p>
      <form action={action} className="mt-4 space-y-3">
        <input type="hidden" name="business_id" value={businessId} />
        <input type="hidden" name="request_id" value={stableRequestId} />
        <input type="hidden" name="review_token" value={reviewToken} />
        {state.message && <p role="alert" className="rounded-xl bg-stone-100 p-3 text-sm">{state.message}</p>}
        <button type="submit" disabled={pending} className="primary min-h-12 w-full disabled:opacity-50">
          {pending ? "Checking opening records…" : "Activate depot"}
        </button>
      </form>
    </section>
  );
}
