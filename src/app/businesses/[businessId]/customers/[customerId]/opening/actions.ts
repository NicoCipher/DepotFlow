"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/domain/ids";
import { parseOpeningQuantity } from "@/domain/opening-physical-count";
import { validCapturedOpeningDate } from "@/domain/opening-business-date";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

export type CustomerOpeningState = { message: string };

type OwedLine = { type: string; quantity: number };

function parseLines(
  raw: FormDataEntryValue | null,
  permitted: Set<string>,
  exactUuid: boolean,
): OwedLine[] | null {
  if (typeof raw !== "string" || raw.length > 10000) return null;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!Array.isArray(candidate) || candidate.length > 100) return null;
    const used = new Set<string>();
    const result: OwedLine[] = [];
    for (const value of candidate) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const row = value as Record<string, unknown>;
      if (typeof row.type !== "string" || !permitted.has(row.type) ||
        (exactUuid && !isUuid(row.type)) || used.has(row.type) ||
        typeof row.quantity !== "number" ||
        !Number.isSafeInteger(row.quantity) ||
        row.quantity < 1 || row.quantity > 2147483647) return null;
      used.add(row.type);
      result.push({ type: row.type, quantity: row.quantity });
    }
    return result;
  } catch {
    return null;
  }
}

/** Customer financial and empty-container openings are ONE business-scoped
 * PostgreSQL transaction through the already-staged RPC. Do not emulate
 * it with separate debt/deposit/obligation table writes.
 */
export async function saveCustomerOpening(
  _previous: CustomerOpeningState,
  form: FormData,
): Promise<CustomerOpeningState> {
  const businessId = String(form.get("business_id") ?? "");
  const customerId = String(form.get("customer_id") ?? "");
  const requestId = String(form.get("request_id") ?? "");
  const capturedBusinessDate = form.get("business_date");
  if (!isUuid(businessId) || !isUuid(customerId) || !isUuid(requestId)) {
    return { message: "Opening request is invalid. Reopen this customer's setup." };
  }

  if (!validCapturedOpeningDate(capturedBusinessDate)) {
    return { message: "The original opening date is missing. Reopen this customer." };
  }
  if (form.get("confirmed") !== "on") {
    return { message: "Confirm that these are balances from before DepotFlow." };
  }
  const amount = parseOpeningQuantity(form.get("old_debt"));
  const deposit = parseOpeningQuantity(form.get("refundable_deposit"));
  const note = String(form.get("note") ?? "").trim().slice(0, 300);
  if (amount === null || deposit === null) {
    return { message: "Enter valid whole-naira amounts, including zero." };
  }

  const owner = await loadOwnerAssortment(businessId);
  if (owner.state !== "ready") {
    return { message: "Opening balances are not available for this depot." };
  }
  const { snapshot } = owner;
  const exactCrates = new Set(snapshot.crateTypes.map((c) => c.id));
  const bottleTypes = new Set(snapshot.configuredDrinks
    .filter((p) => p.active && p.returnable && p.bottleType)
    .map((p) => p.bottleType as string));
  const crates = parseLines(form.get("crates"), exactCrates, true);
  const bottles = parseLines(form.get("bottles"), bottleTypes, false);
  if (!crates || !bottles) {
    return { message: "Check the exact crate or bottle types and quantities." };
  }
  if (amount === 0 && deposit === 0 && !crates.length && !bottles.length) {
    return {
      message: "Nothing is owed. No opening transaction is needed; check this customer's history during final owner review.",
    };
  }

  const supabase = await createClient();
  // The DB routine independently validates active owner membership AND
  // customer business identity before touching financial balances.
  const customer = await supabase.from("customers")
    .select("id,business_id")
    .eq("id", customerId)
    .eq("business_id", businessId)
    .is("archived_at", null)
    .maybeSingle();
  if (customer.error || customer.data?.business_id !== businessId) {
    return { message: "This customer is not available in your selected depot." };
  }

  const { data, error } = await supabase.rpc("record_business_customer_opening", {
    p_business_id: businessId,
    p_request_id: requestId,
    p_customer_id: customerId,
    p_amount: amount,
    p_deposit: deposit,
    p_business_date: capturedBusinessDate,
    p_note: note,
    p_crates: crates,
    p_bottles: bottles,
  });

  if (error || !data || typeof data !== "object" || Array.isArray(data) ||
    data.businessId !== businessId || data.requestId !== requestId ||
    data.customerId !== customerId || typeof data.openingId !== "string") {
    return {
      message: "The opening was not confirmed. Check the customer's saved balances before retrying.",
    };
  }
  redirect(`/businesses/${businessId}/customers?opened=1`);
}
