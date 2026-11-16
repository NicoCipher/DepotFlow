import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/database";
import { supabaseConfig } from "@/lib/supabase/config";

const allowedTypes = new Set(["invite", "recovery", "signup", "email"]);

function safeNext(value: string | null): string {
  return value === "/set-password" || value === "/businesses" ? value : "/set-password";
}

function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && /^https:\/\//.test(configured)) return new URL(configured).origin;
  if (
    process.env.NODE_ENV !== "production" &&
    configured &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(configured)
  ) return new URL(configured).origin;
  return request.nextUrl.origin;
}

function callbackClient(request: NextRequest, response: NextResponse) {
  const { url, key } = supabaseConfig();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const origin = appOrigin(request);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");

  if (tokenHash && type && allowedTypes.has(type)) {
    const response = NextResponse.redirect(new URL(next, origin));
    const supabase = callbackClient(request, response);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "invite" | "recovery" | "signup" | "email",
    });
    if (!error) return response;
    return NextResponse.redirect(new URL("/sign-in?auth_error=link", origin));
  }

  // Also support Supabase's PKCE confirmation links when the project is
  // configured to return an authorization code rather than a token hash.
  if (code) {
    const response = NextResponse.redirect(new URL(next, origin));
    const supabase = callbackClient(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  return NextResponse.redirect(new URL("/sign-in?auth_error=link", origin));
}
