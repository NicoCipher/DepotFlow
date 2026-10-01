"use server";
import { requireOwner } from "@/lib/auth/owner";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function saveEmptyReturn(
  _previous: { message: string },
  form: FormData,
) {
  const db = await requireOwner();
  const customer = String(form.get("customer") ?? "");
  const request = String(form.get("request") ?? "");
  if (![customer, request].every((value) => /^[0-9a-f-]{36}$/i.test(value)))
    return { message: "Could not find this customer. Open their page again." };
  const crates: { crateTypeId: string; quantity: number }[] = [];
  const bottles: { bottleType: string; quantity: number }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("crate:") && !key.startsWith("bottle:")) continue;
    const raw = String(value).trim();
    if (!/^[0-9]{1,9}$/.test(raw))
      return {
        message:
          "Enter whole counts, using 0 for any type that did not come back.",
      };
    if (Number(raw) === 0) continue;
    if (key.startsWith("crate:"))
      crates.push({ crateTypeId: key.slice(6), quantity: Number(raw) });
    else bottles.push({ bottleType: key.slice(7), quantity: Number(raw) });
  }
  crates.sort((a, b) => a.crateTypeId.localeCompare(b.crateTypeId));
  bottles.sort((a, b) => a.bottleType.localeCompare(b.bottleType));
  const released = form.getAll("released").map(String).sort();
  if (!crates.length && !bottles.length && !released.length)
    return {
      message:
        "Enter what came back, or tick the held empties you handed back.",
    };
  try {
    const { error } = await db.rpc("record_customer_empty_return", {
      p_request_id: request,
      p_customer_id: customer,
      p_crates: crates,
      p_bottles: bottles,
      p_release_ids: released,
    });
    if (error)
      return {
        message:
          error.code === "22023"
            ? "Check the counts and held empties. They may have been recorded already. Your entries are still here."
            : "Could not confirm this return. Keep these entries and try again; the same return will only be saved once.",
      };
  } catch {
    return {
      message:
        "Could not confirm this return. Keep these entries and try again; the same return will only be saved once.",
    };
  }
  revalidatePath(`/customers/${customer}`);
  revalidatePath("/empty-crates");
  redirect(`/customers/${customer}?saved=empties`);
}
