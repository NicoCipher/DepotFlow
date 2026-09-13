import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ownerAuthorized } from "@/domain/authorization";

export async function ownerSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return { supabase, allowed: false };
  const { data, error } = await supabase.rpc("is_shop_owner");
  return { supabase, allowed: ownerAuthorized(user.id, data, error) };
}

export async function requireOwner() {
  const session = await ownerSession();
  if (!session.allowed) redirect("/sign-in");
  return session.supabase;
}
