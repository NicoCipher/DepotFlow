"use server";

import { redirect } from "next/navigation";
import { parseBusinessAssortment, validateDrinkSetup } from "@/domain/business-assortment";
import { isUuid } from "@/domain/ids";
import { createClient } from "@/lib/supabase/server";

export type SetupActionState = { message: string };
const unavailable = "This depot's guided setup is not available. No changes were saved.";

async function verifiedSetup(businessId: string) {
  if (!isUuid(businessId)) return null;
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) return null;
  const { data: businesses, error } = await supabase.rpc("list_my_businesses_for_setup");
  if (error || !businesses?.some((b) =>
    b.business_id === businessId && b.business_status === "setup")) return null;
  // The privileged backend independently checks owner membership + gate.
  const setup = await supabase.rpc("preview_business_assortment_setup", {
    p_business_id: businessId,
  });
  if (setup.error || !setup.data ||
    !parseBusinessAssortment(setup.data, businessId)) return null;
  // Reject missing counts/truncation on POST too. A caller must never be
  // able to bypass a capped/partial GET by submitting an old form.
  return { supabase };
}

export async function addSetupCrate(
  _prior: SetupActionState, form: FormData,
): Promise<SetupActionState> {
  const businessId = String(form.get("business_id") ?? "");
  const requestId = String(form.get("crate_id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const family = String(form.get("family") ?? "").trim();
  const variant = String(form.get("variant") ?? "").trim();
  const pockets = Number(form.get("pockets"));
  if (!isUuid(requestId) || name.length < 1 || name.length > 120 ||
      family.length < 1 || family.length > 80 || variant.length > 120 ||
      !Number.isSafeInteger(pockets) || pockets < 1 || pockets > 120) {
    return { message: "Enter the exact crate name, brewery and bottle pockets." };
  }
  const verified = await verifiedSetup(businessId);
  if (!verified) return { message: unavailable };
  const { error } = await verified.supabase.rpc("create_business_crate_type", {
    p_business_id: businessId,
    p_crate_type_id: requestId,
    p_name: name,
    p_empty_family: family,
    p_pocket_count: pockets,
    p_variant: variant || null,
  });
  if (error) return {
    message: "Could not save this crate. Check your business and crate details before retrying.",
  };
  redirect(`/businesses/${businessId}/drinks`);
}

function optionalPrice(value: FormDataEntryValue | null) {
  if (!value || String(value).trim() === "") return null;
  return Number(value);
}

export async function addSetupDrink(
  _prior: SetupActionState, form: FormData,
): Promise<SetupActionState> {
  const businessId = String(form.get("business_id") ?? "");
  const productId = String(form.get("product_id") ?? "");
  const catalogueId = String(form.get("catalogue_id") ?? "");
  const crateId = String(form.get("crate_type_id") ?? "");
  const pack = Number(form.get("pack"));
  const price = Number(form.get("full_price"));
  const bottlePrice = optionalPrice(form.get("bottle_price"));
  const returnable = form.get("returnable") === "on";
  const bottleType = String(form.get("bottle_type") ?? "").trim();
  const size = String(form.get("size") ?? "").trim();
  if (![businessId, productId, catalogueId, crateId].every(isUuid) ||
      size.length > 120 || bottleType.length > 120) {
    return { message: "Choose your depot, drink and exact physical crate." };
  }
  const validation = validateDrinkSetup({
    price, pack, bottlePrice, returnable, bottleType,
  });
  if (validation) return { message: validation };
  const verified = await verifiedSetup(businessId);
  if (!verified) return { message: unavailable };
  // No provisional stock is added here. Counts are an independent opening
  // step and must be saved as their own immutable physical records.
  const { error } = await verified.supabase.rpc("add_business_catalogue_drink", {
    p_business_id: businessId,
    p_product_id: productId,
    p_catalogue_product_id: catalogueId,
    p_crate_type_id: crateId,
    p_bottles_per_crate: pack,
    p_full_crate_price: price,
    p_half_crate_price: null,
    p_quarter_crate_price: null,
    p_bottle_price: bottlePrice,
    p_bottles_returnable: returnable,
    p_bottle_type: returnable ? bottleType : null,
    p_size: size || null,
  });
  if (error) return {
    message: "Could not save this drink. Check the crate pockets, returnable bottle and ₦50 pricing. It may already be configured.",
  };
  redirect(`/businesses/${businessId}/drinks`);
}
