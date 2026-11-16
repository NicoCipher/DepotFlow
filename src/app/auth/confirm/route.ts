import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedTypes = new Set(["invite", "recovery", "signup", "email"]);

function safeNext(value: string | null): string {
  return value === "/set-password" || value === "/businesses" ? value : "/set-password";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");

  if (tokenHash && type && allowedTypes.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "invite" | "recovery" | "signup" | "email",
    });
    if (error) {
      return NextResponse.redirect(new URL("/sign-in?auth_error=link", request.url));
    }
    return NextResponse.redirect(new URL(next, request.url));
  }

  // Also support Supabase's PKCE confirmation links when the project is
  // configured to return an authorization code rather than a token hash.
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(new URL("/sign-in?auth_error=link", request.url));
}
