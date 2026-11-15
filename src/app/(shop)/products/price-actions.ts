"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";

type PriceChange = {
  product_id: string;
  change_selling: boolean;
  change_cost: boolean;
  expected_full_crate_price: number;
  new_full_crate_price: number;
  expected_bottle_price: number | null;
  new_bottle_price: number | null;
  expected_half_crate_price: number | null;
  new_half_crate_price: number | null;
  expected_quarter_crate_price: number | null;
  new_quarter_crate_price: number | null;
  catalogue_product_id: string | null;
  expected_cost_price: number | null;
  new_cost_price: number | null;
};

export type BulkPriceActionState = { message?: string; saved?: boolean };

function validAmount(value: unknown, allowNull = false): value is number | null {
  if (allowNull && value === null) return true;
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= 2_147_483_600;
}

export async function saveBulkPrices(
  _previous: BulkPriceActionState,
  formData: FormData,
): Promise<BulkPriceActionState> {
  const supabase = await requireOwner();
  const requestId = String(formData.get("request_id") ?? "");
  const raw = String(formData.get("changes") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return { message: "Please review the prices again and retry." };
  }
  let changes: unknown;
  try {
    changes = JSON.parse(raw);
  } catch {
    return { message: "The price list could not be read. Your edits are still here; review again." };
  }
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 500) {
    return { message: "Change at least one price before saving." };
  }
  const seen = new Set<string>();
  for (const item of changes as Partial<PriceChange>[]) {
    if (!item || typeof item.product_id !== "string"
      || !/^[0-9a-f-]{36}$/i.test(item.product_id)
      || seen.has(item.product_id)
      || typeof item.change_selling !== "boolean"
      || typeof item.change_cost !== "boolean"
      || (!item.change_selling && !item.change_cost)
      || (item.change_selling && (
        !validAmount(item.expected_full_crate_price)
        || !validAmount(item.new_full_crate_price)
        || item.new_full_crate_price! % 50 !== 0
        || !validAmount(item.expected_bottle_price, true)
        || !validAmount(item.new_bottle_price, true)
        || !validAmount(item.expected_half_crate_price, true)
        || !validAmount(item.new_half_crate_price, true)
        || !validAmount(item.expected_quarter_crate_price, true)
        || !validAmount(item.new_quarter_crate_price, true)
        || [item.new_bottle_price, item.new_half_crate_price, item.new_quarter_crate_price]
          .some((price) => price !== null && price !== undefined && price % 50 !== 0)
      ))
      || (item.change_cost && (
        typeof item.catalogue_product_id !== "string"
        || !/^[0-9a-f-]{36}$/i.test(item.catalogue_product_id)
        || !validAmount(item.expected_cost_price, true)
        || !validAmount(item.new_cost_price)
      ))) {
      return { message: "One of the prices is invalid. Check the highlighted values and review again." };
    }
    seen.add(item.product_id);
  }
  try {
    const { error } = await supabase.rpc("update_legacy_product_prices", {
      p_request_id: requestId,
      p_changes: changes as import("@/types/database").Json,
    });
    if (error) {
      return {
        message: error.code === "40001"
          ? "A price changed on another screen. Refresh the list and review your changes again."
          : error.code === "42501"
            ? "Price updates are not enabled for this shop yet."
            : "Prices were not saved. Your edits are still here; check the list and retry.",
      };
    }
  } catch {
    return { message: "We could not confirm the save. Refresh the list before retrying." };
  }
  revalidatePath("/products");
  revalidatePath("/products/prices");
  revalidatePath("/products/catalogue");
  revalidatePath("/record-sale");
  revalidatePath("/stock");
  return { saved: true, message: "Prices saved." };
}
