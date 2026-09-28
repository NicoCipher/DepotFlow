import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ownerAuthorized } from "@/domain/authorization";

async function loadOwnerSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError)
    return {
      supabase,
      user: null,
      allowed: false,
      status: "temporary_error" as const,
    };
  if (!user)
    return {
      supabase,
      user: null,
      allowed: false,
      status: "signed_out" as const,
    };

  const { data, error } = await supabase.rpc("is_shop_owner");
  return {
    supabase,
    user,
    allowed: ownerAuthorized(user.id, data, error),
    status: error
      ? ("temporary_error" as const)
      : data === true
        ? ("ready" as const)
        : ("signed_out" as const),
  };
}

// React cache deduplicates the auth + owner check within one server render.
// This avoids repeating the same network round trips in the shop layout,
// page, and nested data loaders while keeping every request freshly checked.
export const ownerSession = cache(loadOwnerSession);

export async function requireOwnerSession() {
  const session = await ownerSession();
  if (!session.allowed || !session.user) redirect("/sign-in");
  return {
    supabase: session.supabase,
    user: session.user,
  };
}

export async function requireOwner() {
  return (await requireOwnerSession()).supabase;
}
