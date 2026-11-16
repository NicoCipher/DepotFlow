import "server-only";

import { ownerAuthorized } from "@/domain/authorization";
import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Resolve a signed-in user's first screen without weakening either
 * authorization path. A single verified tenant opens directly; multiple
 * tenants require an explicit choice. The legacy shop remains a fallback
 * only when no tenant membership is available.
 */
export async function resolveSignInDestination(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const businesses = await supabase.rpc("list_my_businesses_for_setup");

  if (!businesses.error) {
    const owned = businesses.data ?? [];
    if (owned.length === 1) {
      const business = owned[0];
      return business.business_status === "setup"
        ? `/businesses/${business.business_id}/drinks`
        : `/businesses/${business.business_id}/sales`;
    }
    if (owned.length > 1) return "/businesses";

    // An eligible, verified account with no depot may enter the gated
    // registration screen. This RPC remains the authority for that access.
    const registration = await supabase.rpc("can_register_business");
    if (!registration.error && registration.data === true) return "/businesses";
  }

  // Preserve the existing legacy owner boundary if the tenant listing is
  // unavailable or the account has no tenant memberships.
  const owner = await supabase.rpc("is_shop_owner");
  return ownerAuthorized(userId, owner.data, owner.error) ? "/" : null;
}
