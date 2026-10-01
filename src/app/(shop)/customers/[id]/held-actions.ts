"use server";
import { requireOwner } from "@/lib/auth/owner";
import { revalidatePath } from "next/cache";
export async function releaseHeldEmpties(form: FormData) {
  const db = await requireOwner();
  const id = String(form.get("id") ?? "");
  const customer = String(form.get("customer") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(customer))
    throw new Error("Could not find these held empties.");
  const { error } = await db.rpc("release_held_empties", { p_id: id });
  if (error) throw new Error("Could not record collection. Please try again.");
  revalidatePath(`/customers/${customer}`);
}
