import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/database";
import { supabaseConfig } from "@/lib/supabase/config";

const allowedTypes = new Set(["invite", "recovery", "signup", "email"]);

function safeNext(value: string | null): string {
  return value === "/set-password" || value === "/businesses" ? value : "/set-password";
}

function appOrigin(request: NextRequest): string {
  // Keep the callback on the exact host that received the one-time link.
  // Supabase session cookies are scoped to that host; redirecting to a
  // separately configured origin would strand the verified session.
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
