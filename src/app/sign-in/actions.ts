"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ownerAuthorized } from "@/domain/authorization";
import { safeSignInReturnPath } from "@/domain/auth-navigation";
import { clearRejectedSignInCookies } from "@/lib/auth/rejected-signin-cleanup";
import { resolveSignInDestination } from "@/lib/auth/sign-in-destination";

export type SignInState = { email: string; message: string };

type AuthClient = Awaited<ReturnType<typeof createClient>>;

/** Never ignore a {error} signOut result on an already authenticated user. */
async function rejectAuthenticatedLogin(
  supabase: AuthClient, email: string, deniedMessage: string,
): Promise<SignInState> {
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (!error) return { email, message: deniedMessage };
  } catch {
    // Cookie cleanup below still runs if the Auth service is unreachable.
  }
  try {
    if (await clearRejectedSignInCookies()) {
      return { email, message: deniedMessage };
    }
  } catch {
    // Cannot claim a safely cleared session.
  }
  return {
    email,
    message: "Sign-in was rejected but session cleanup could not be confirmed. Close this browser before sharing this device and try again.",
  };
}

export async function signIn(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .slice(0, 254);
  const password = String(formData.get("password") ?? "");
  const returnTo = safeSignInReturnPath(formData.get("return_to"));
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    password.length > 1024
  ) {
    return { email, message: "Enter your email and password." };
  }

  let destination = returnTo;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) {
      return {
        email,
        message: "Could not sign in. Check your details and try again.",
      };
    }

    if (returnTo === "/") {
      // One sign-in path: verified tenant membership takes the user to
      // their only depot or to the picker; legacy owners retain the shop.
      const resolved = await resolveSignInDestination(supabase, data.user.id);
      if (!resolved) {
        return rejectAuthenticatedLogin(
          supabase,
          email,
          "Depot access is not available for this account. Contact the depot owner for access.",
        );
      }
      destination = resolved;
    } else if (returnTo === "/businesses") {
      // Preserve the independently gated business onboarding route for
      // password-setup and registration links.
      const depots = await supabase.rpc("list_my_businesses_for_setup");
      const registration = !depots.error && !depots.data?.length
        ? await supabase.rpc("can_register_business")
        : null;
      if (
        depots.error ||
        (!depots.data?.length &&
          (registration?.error || registration?.data !== true))
      ) {
        return rejectAuthenticatedLogin(
          supabase, email, "Multi-business setup is not available for this account yet.",
        );
      }
    } else {
      // Existing shop URLs keep their original owner-only authorization.
      const owner = await supabase.rpc("is_shop_owner");
      if (!ownerAuthorized(data.user.id, owner.data, owner.error)) {
        return rejectAuthenticatedLogin(
          supabase, email, "This app is only available to the shop owner.",
        );
      }
    }
  } catch {
    return { email, message: "Could not connect. Please try again." };
  }
  redirect(destination);
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error("Could not sign out. Please try again.");
  redirect("/sign-in");
}
