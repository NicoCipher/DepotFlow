"use client";

import { useActionState } from "react";
import {
  createPersonalAccount,
  type CreateAccountState,
} from "@/app/sign-up/actions";

const initial: CreateAccountState = {
  email: "", submitted: false, message: "",
};

/** Mobile-first signup, not business creation. The server owns all gating. */
export function CreateAccountForm() {
  const [state, action, pending] = useActionState(createPersonalAccount, initial);
  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="new-account-email" className="block font-semibold">
          Email address
        </label>
        <input
          id="new-account-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          required
          defaultValue={state.email}
          disabled={pending || state.submitted}
          placeholder="you@example.com"
          className="w-full"
        />
      </div>

      <div>
        <label htmlFor="new-account-password" className="block font-semibold">
          Password
        </label>
        <input
          id="new-account-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          required
          disabled={pending || state.submitted}
          className="w-full"
        />
        <p className="mt-1 text-xs leading-5 text-stone-600">
          Use at least 12 characters. Never share your password with depot attendants.
        </p>
      </div>

      <div>
        <label htmlFor="new-account-confirm" className="block font-semibold">
          Confirm password
        </label>
        <input
          id="new-account-confirm"
          name="password_confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          required
          disabled={pending || state.submitted}
          className="w-full"
        />
      </div>

      {state.message && (
        <p role={state.submitted ? "status" : "alert"}
          className="rounded-xl bg-stone-100 p-3 text-sm leading-6 text-stone-800">
          {state.message}
        </p>
      )}

      <button type="submit" className="primary min-h-12 w-full"
        disabled={pending || state.submitted}>
        {pending ? "Creating your account…" :
          state.submitted ? "Verification email requested" : "Create personal account"}
      </button>
    </form>
  );
}
