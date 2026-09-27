"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";

function depositAmount(formData: FormData) {
  const raw = String(formData.get("amount") ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new Error("invalid");
  const amount = Number(raw);
  if (
    !Number.isSafeInteger(amount) ||
    amount < 50 ||
    amount > 2147483647 ||
    amount % 50 !== 0
  )
    throw new Error("invalid");
  return amount;
}

export async function saveDepositPrice(formData: FormData) {
  const supabase = await requireOwner();
  const kind = String(formData.get("kind") ?? "");
  const key = String(formData.get("key") ?? "");
  let amount: number;
  try {
    amount = depositAmount(formData);
  } catch {
    redirect("/empties-rules?error=price");
  }

  const result =
    kind === "crate" && isProductId(key)
      ? await supabase.rpc("set_crate_deposit_price", {
          p_crate_type_id: key,
          p_amount: amount,
        })
      : kind === "bottle" && key.trim().length > 0 && key.length <= 120
        ? await supabase.rpc("set_bottle_deposit_price", {
            p_bottle_type: key,
            p_amount: amount,
          })
        : null;

  if (!result || result.error) redirect("/empties-rules?error=price");
  revalidatePath("/empties-rules");
  redirect("/empties-rules?saved=price");
}
