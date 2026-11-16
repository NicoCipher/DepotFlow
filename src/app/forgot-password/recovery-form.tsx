"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "./actions";

export function RecoveryForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, { message: "", sent: false });
  return (
    <form action={action} className="mt-6 space-y-5">
      <div>
        <label htmlFor="email">Account email</label>
        <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" maxLength={254} required />
      </div>
      {state.message && <p role="status" className="text-sm text-stone-700">{state.message}</p>}
      <button disabled={pending} className="primary w-full">
        {pending ? "Sending…" : "Send password link"}
      </button>
    </form>
  );
}
