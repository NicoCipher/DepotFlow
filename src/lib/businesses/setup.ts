import "server-only";
import { notFound, redirect } from "next/navigation";
import { parseBusinessAssortment, type AssortmentSetup } from "@/domain/business-assortment";
import { isUuid } from "@/domain/ids";
import { createClient } from "@/lib/supabase/server";

type BusinessSetupLoad =
  | { state: "disabled" }
  | { state: "incomplete" }
  | { state: "ready"; snapshot: AssortmentSetup; name: string };

/** Never trust a route's business UUID. The owner MUST be on the
 * authenticated gated picker and the assortment preview independently
 * re-verifies the same owner for this exact SETUP business.
 */
export async function loadOwnerAssortment(businessId: string): Promise<BusinessSetupLoad> {
  if (!isUuid(businessId)) notFound();
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/sign-in?next=%2Fbusinesses");

  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  if (listError) return { state: "disabled" };
  const business = businesses?.find((b) =>
    b.business_id === businessId && b.business_status === "setup");
  if (!business) notFound();

  const { data, error } = await supabase.rpc("preview_business_assortment_setup", {
    p_business_id: businessId,
  });
  if (error || !data) return { state: "disabled" };
  const snapshot = parseBusinessAssortment(data, businessId);
  if (!snapshot) {
    // A deliberately capped catalogue is not a complete stock setup.
    // Keep every write unavailable and tell the owner why, rather than
    // silently presenting a partial list as the full business catalogue.
    if (data && typeof data === "object" && !Array.isArray(data) &&
      data.businessId === businessId && data.truncated === true) {
      return { state: "incomplete" };
    }
    throw new Error("Could not verify the selected depot's guided setup.");
  }
  return { state: "ready", snapshot, name: business.business_name };
}
