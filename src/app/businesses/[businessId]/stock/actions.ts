"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/domain/ids";
import { parseOpeningQuantity, isValidDrinkOpeningQuantity } from "@/domain/opening-physical-count";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

export type OpeningCountState = { message: string };

type OpeningKind = "drink" | "crate" | "bottle";

function businessDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(new Date());
  const n = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${n("year")}-${n("month")}-${n("day")}`;
}

/** This action cannot create ordinary stock adjustments or activate a
 * business; it invokes only the explicitly gated first-opening RPC.
 */
export async function recordBusinessOpeningCount(
  _previous: OpeningCountState,
  form: FormData,
): Promise<OpeningCountState> {
  const businessId = String(form.get("business_id") ?? "");
  const requestId = String(form.get("request_id") ?? "");
  const kind = String(form.get("kind") ?? "") as OpeningKind;
  const resource = String(form.get("resource") ?? "").trim();

  if (!isUuid(businessId) || !isUuid(requestId) ||
    !["drink", "crate", "bottle"].includes(kind)) {
    return { message: "The depot or stock request is invalid. Reload the page." };
  }
  const assortment = await loadOwnerAssortment(businessId);
  if (assortment.state !== "ready") {
    return { message: "This depot's starting stock cannot be recorded yet." };
  }

  const { snapshot } = assortment;
  let quantity: number | null;
  let loose = 0;
  let pack = 0;

  if (kind === "drink") {
    const drink = snapshot.configuredDrinks.find((p) =>
      p.id === resource && p.active);
    if (!drink || !isUuid(resource) || !drink.packSize ||
      !Number.isInteger(drink.packSize) || drink.packSize <= 0) {
      return { message: "Choose an active drink belonging to this depot." };
    }
    pack = drink.packSize;
    quantity = parseOpeningQuantity(form.get("full_crates"));
    const readLoose = parseOpeningQuantity(form.get("loose_bottles"));
    if (!isValidDrinkOpeningQuantity(quantity, readLoose, pack)) {
      return { message: "Enter whole crates and loose bottles below one full crate." };
    }
    loose = readLoose;
  } else {
    quantity = parseOpeningQuantity(form.get("quantity"));
    if (quantity === null) return { message: "Enter a valid whole-unit count, including zero." };
    if (kind === "crate" && !snapshot.crateTypes.some((c) =>
      c.id === resource && isUuid(resource))) {
      return { message: "Choose an exact crate type belonging to this depot." };
    }
    if (kind === "bottle" && !snapshot.configuredDrinks.some((d) =>
      d.active && d.returnable && d.bottleType === resource)) {
      return { message: "Choose a returnable bottle type configured for this depot." };
    }
  }

  // The underlying DB procedure independently checks the same ownership,
  // per-item first-only rule, live product metadata, exact request UUID,
  // snapshot setup status and all currently disabled permissions.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_business_physical_opening", {
    p_business_id: businessId,
    p_request_id: requestId,
    p_kind: kind,
    p_resource: resource,
    p_quantity: quantity,
    p_loose: loose,
    p_pack: pack,
    p_business_date: businessDate(),
  });

  if (error || !data || typeof data !== "object" || Array.isArray(data) ||
    data.businessId !== businessId || data.requestId !== requestId ||
    data.kind !== kind || data.resource !== resource) {
    return {
      message: "The count was not confirmed. Check this depot's saved counts before trying again.",
    };
  }

  redirect(`/businesses/${businessId}/stock?recorded=1`);
}
