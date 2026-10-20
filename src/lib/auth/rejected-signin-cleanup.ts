import "server-only";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * Best-effort, browser-local fallback when Supabase Auth accepted credentials
 * but rejected-account cleanup could not complete with auth.signOut().
 *
 * The SSR session belongs to the exact configured project's auth cookie.
 * Clear its base, chunked, and PKCE verifier cookies only. Never delete
 * arbitrary sb-* cookies from other projects on a shared hostname.
 * This removes this browser's tokens, not already-issued JWT validity.
 */
export async function clearRejectedSignInCookies(): Promise<boolean> {
  const { url } = supabaseConfig();
  const host = new URL(url).hostname;
  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
  if (!match) return false; // Unknown storage key: do not pretend cleanup.
  const base = `sb-${match[1]}-auth-token`;
  const cookieStore = await cookies();
  const names = cookieStore.getAll()
    .map(({ name }) => name)
    .filter((name) => name === base || name.startsWith(`${base}.`) ||
      name === `${base}-code-verifier`);
  if (names.length === 0) return false;
  for (const name of names) cookieStore.delete(name);
  return names.every((name) => !cookieStore.get(name));
}
