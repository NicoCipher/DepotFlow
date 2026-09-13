import "server-only";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { isCustomerId } from "@/domain/customers";

export async function getCustomer(id: string) {
  const supabase = await requireOwner();
  if (!isCustomerId(id)) notFound();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load customer.");
  if (!data) notFound();
  return { customer: data, supabase };
}
