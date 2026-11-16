"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type RecoveryState = { message: string; sent: boolean };

export async function requestPasswordReset(
  _previous: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const email = String(formData.get("email") ?? "").trim().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { message: "Enter a valid email address.", sent: false };
  }

  // Prefer the explicitly configured canonical origin. The request host is
  // only a fallback for local development, never a user-supplied redirect.
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") === "http" ? "http" : "https";
  const origin = configuredOrigin && /^https:\/\//.test(configuredOrigin)
    ? configuredOrigin.replace(/\/$/, "")
    : host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      ? `${protocol}://${host}`
      : "https://depotflow-bice.vercel.app";

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=%2Fset-password`,
  });
  // Avoid disclosing whether an account exists.
  if (error) {
    return { message: "If this email belongs to a DepotFlow account, a password link will be sent. Check your inbox and spam folder.", sent: true };
  }
  return { message: "If this email belongs to a DepotFlow account, a password link will be sent. Check your inbox and spam folder.", sent: true };
}
