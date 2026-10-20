"use client";

import { useActionState } from "react";
import { addSetupCrate } from "@/app/businesses/[businessId]/drinks/actions";

export function SetupCrateForm({
  businessId, crateId,
}: {
  businessId: string; crateId: string;
}) {
  const [state, action, pending] = useActionState(addSetupCrate, { message: "" });
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="business_id" value={businessId} />
      <input type="hidden" name="crate_id" value={crateId} />
      <h2 className="font-bold text-stone-950">Set up a physical crate type</h2>
      <p className="text-xs leading-5 text-stone-600">
        Drinks can share a crate only when the physical crate really matches.
        Goldberg, Life and 33 may share one NBL crate type. Heineken and Gulder
        must remain different even when their pocket counts match.
      </p>
      <div>
        <label htmlFor="setup-crate-name">Crate name</label>
        <input id="setup-crate-name" name="name" required maxLength={120}
          placeholder="e.g. NBL 33 / Life / Goldberg" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="setup-crate-family">Brewery</label>
          <input id="setup-crate-family" name="family" required maxLength={80}
            placeholder="e.g. NBL" />
        </div>
        <div>
          <label htmlFor="setup-crate-pockets">Bottle pockets</label>
          <input id="setup-crate-pockets" name="pockets" type="number"
            required min={1} max={120} step={1} placeholder="20" />
        </div>
      </div>
      <div>
        <label htmlFor="setup-crate-variant">Crate variant (optional)</label>
        <input id="setup-crate-variant" name="variant" maxLength={120}
          placeholder="Only if needed to identify the crate" />
      </div>
      {state.message && <p role="alert" className="text-sm text-red-800">{state.message}</p>}
      <button className="primary min-h-12 w-full" disabled={pending}>
        {pending ? "Saving crate…" : "Save crate type"}
      </button>
    </form>
  );
}
