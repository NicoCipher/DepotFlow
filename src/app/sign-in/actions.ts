"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ownerAuthorized } from "@/domain/authorization";

export type SignInState = { email: string; message: string };
export async function signIn(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .slice(0, 254);
  const password = String(formData.get("password") ?? "");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    password.length > 1024
  ) {
    return { email, message: "Enter your email and password." };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user)
      return {
        email,
        message: "Could not sign in. Check your details and try again.",
      };
    const owner = await supabase.rpc("is_shop_owner");
    if (!ownerAuthorized(data.user.id, owner.data, owner.error)) {
      await supabase.auth.signOut({ scope: "local" });
      return {
        email,
        message: "This app is only available to the shop owner.",
      };
    }
  } catch {
    return { email, message: "Could not connect. Please try again." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error("Could not sign out. Please try again.");
  redirect("/sign-in");
}
