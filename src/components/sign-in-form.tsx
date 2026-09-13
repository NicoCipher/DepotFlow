"use client";

import { useActionState } from "react";
import { signIn } from "@/app/sign-in/actions";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, {
    email: "",
    message: "",
  });
  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          maxLength={254}
          defaultValue={state.email}
        />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
        />
      </div>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <button disabled={pending} className="primary w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
