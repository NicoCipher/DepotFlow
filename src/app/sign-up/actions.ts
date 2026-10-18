"use server";

import { publicSignupConfig } from "@/domain/public-signup";
import { createClient } from "@/lib/supabase/server";

export type CreateAccountState = {
  email: string;
  submitted: boolean;
  message: string;
};

/** Personal account only. An anonymous form must NEVER provision a
 * business/membership or touch Walnik's records. Auth emails are delivered
 * by Supabase Auth; password/confirmation is never written to app tables.
 */
export async function createPersonalAccount(
  _prior: CreateAccountState,
  form: FormData,
): Promise<CreateAccountState> {
  const config = publicSignupConfig();
  if (!config.enabled || !config.emailRedirectTo) {
    return {
      email: "", submitted: false,
      message: "Personal account registration is not available yet.",
    };
  }

  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("password_confirmation") ?? "");

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 12 || password.length > 1024 ||
    password !== confirmation
  ) {
    return {
      email, submitted: false,
      message: "Enter a valid email and matching password of at least 12 characters.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: config.emailRedirectTo },
    });
    if (error) {
      // Avoid exposing whether the account already exists; registration
      // providers and email deliveries can return masked users.
      return {
        email, submitted: false,
        message: "Could not submit registration. Please try again later or sign in.",
      };
    }

    // Security prerequisite: a confirmed email MUST be required. When a
    // project incorrectly auto-issues a signup session, terminate it and
    // fail closed rather than silently bypassing the verification step.
    if (data.session) {
      await supabase.auth.signOut({ scope: "local" });
      return {
        email: "", submitted: false,
        message: "Account creation requires email confirmation. It is not configured correctly yet.",
      };
    }

    return {
      email, submitted: true,
      message: "Check your inbox for a verification email. If you already have an account, sign in instead. After verification, return to Business accounts to register your depot.",
    };
  } catch {
    return {
      email, submitted: false,
      message: "Could not submit registration. Please try again later.",
    };
  }
}
