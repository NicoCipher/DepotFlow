"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
export async function saveBusiness(form: FormData) {
  const db = await requireOwner();
  const name = String(form.get("name") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const logo_url = String(form.get("logo_url") ?? "").trim();
  if (
    !name ||
    name.length > 120 ||
    address.length > 500 ||
    phone.length > 40 ||
    logo_url.length > 1000
  )
    redirect("/business?error=details");
  if (logo_url) {
    try {
      const url = new URL(logo_url);
      if (url.protocol !== "https:" || url.username || url.password)
        redirect("/business?error=logo");
    } catch {
      redirect("/business?error=logo");
    }
  }
  const { error } = await db.rpc("save_business_details", {
    p_name: name,
    p_address: address,
    p_phone: phone,
    p_logo_url: logo_url,
  });
  if (error)
    throw new Error("Could not save business details. Please try again.");
  revalidatePath("/business");
  redirect("/business?saved=1");
}
