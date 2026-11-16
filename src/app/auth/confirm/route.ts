import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/database";
import { supabaseConfig } from "@/lib/supabase/config";

const allowedTypes = new Set(["invite", "recovery", "signup", "email"]);

function safeNext(value: string | null): string {
  return value === "/set-password" || value === "/businesses" ? value : "/set-password";
}

function appOrigin(request: NextRequest): string {
  // Next's parsed URL can be normalized to localhost in local development.
  // Prefer the original forwarded host so the redirect matches the host that
  // received the link and the host on which Supabase set its session cookies.
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : request.nextUrl.protocol.replace(":", "");
  if (host && /^[a-z0-9.-]+(?::\\d+)?$/i.test(host)) {
    return new URL(`${protocol}://${host}`).origin;
  }
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
