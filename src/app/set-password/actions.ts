"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { message: string };

export async function setPassword(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");
  if (password.length < 12 || password.length > 1024) {
    return { message: "Use a password with at least 12 characters." };
  }
  if (password !== confirmation) {
    return { message: "The passwords do not match." };
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { message: "Your secure setup link has expired. Request a new password link and try again." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { message: "We could not save your password. Request a fresh link and try again." };
  }
  redirect("/businesses");
}
