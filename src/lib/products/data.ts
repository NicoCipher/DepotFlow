import "server-only";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";

export async function getProduct(id: string) {
  const supabase = await requireOwner();
  if (!isProductId(id)) notFound();
  const { data, error } = await supabase
    .from("products")
    .select("*,crate_types(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load product.");
  if (!data) notFound();
  return data;
}
