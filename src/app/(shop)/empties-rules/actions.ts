"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";

function requiredAmount(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "").trim();
  if (!/^\d+$/.test(value)) throw new Error("invalid");
  const amount = Number(value);
  if (
    !Number.isSafeInteger(amount) ||
    amount < 50 ||
    amount > 2147483647 ||
    amount % 50 !== 0
  )
    throw new Error("invalid");
  return amount;
}

function optionalAmount(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "").trim();
  if (!value) return undefined;
  return requiredAmount(value);
}

export async function saveBottleDepositPrice(formData: FormData) {
  const supabase = await requireOwner();
  let amount: number;
  try {
    amount = requiredAmount(formData.get("amount"));
  } catch {
    redirect("/empties-rules?error=price");
  }

  const { error } = await supabase.rpc("set_bottle_deposit_price", {
    p_amount: amount,
  });
  if (error) redirect("/empties-rules?error=price");
  revalidatePath("/empties-rules");
  redirect("/empties-rules?saved=bottle");
}

export async function saveCrateDepositPrice(formData: FormData) {
  const supabase = await requireOwner();
  const pocketRaw = String(formData.get("pocket_count") ?? "").trim();
  let pocketCount: number;
  let completeAmount: number;
  let crateOnlyAmount: number | undefined;

  try {
    if (!/^\d+$/.test(pocketRaw)) throw new Error("invalid");
    pocketCount = Number(pocketRaw);
    if (!Number.isSafeInteger(pocketCount) || pocketCount < 1)
      throw new Error("invalid");
    completeAmount = requiredAmount(formData.get("complete_amount"));
    crateOnlyAmount = optionalAmount(formData.get("crate_only_amount"));
  } catch {
    redirect("/empties-rules?error=price");
  }

  const { error } = await supabase.rpc("set_crate_deposit_price", {
    p_pocket_count: pocketCount,
    p_complete_amount: completeAmount,
    ...(crateOnlyAmount === undefined
      ? {}
      : { p_crate_only_amount: crateOnlyAmount }),
  });
  if (error) redirect("/empties-rules?error=price");
  revalidatePath("/empties-rules");
  redirect("/empties-rules?saved=crate");
}
