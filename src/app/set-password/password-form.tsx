"use client";

import { useActionState } from "react";
import { setPassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(setPassword, { message: "" });
  return (
    <form action={action} className="mt-6 space-y-5">
      <div>
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required />
      </div>
      <div>
        <label htmlFor="confirm_password">Confirm password</label>
        <input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required />
      </div>
      {state.message && <p role="alert" className="text-red-800">{state.message}</p>}
      <button disabled={pending} className="primary w-full">
        {pending ? "Saving password…" : "Save password"}
      </button>
    </form>
  );
}
