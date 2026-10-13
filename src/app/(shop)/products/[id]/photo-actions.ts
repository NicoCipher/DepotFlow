"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { PRODUCT_IMAGE_BUCKET } from "@/domain/product-images";
import { checkOwnerPhoto } from "@/lib/product-photo-upload";
import type { PhotoState } from "@/app/(shop)/products/catalogue/photo-actions";

/** Photos of custom drinks use the same owner-only bucket, not remote links. */
export async function uploadCustomProductPhoto(
  productId: string,
  _previous: PhotoState,
  form: FormData,
): Promise<PhotoState> {
  const supabase = await requireOwner();
  const invalid = (message: string): PhotoState => ({ message, saved: false });
  if (!isProductId(productId)) return invalid("Choose this drink again.");
  const checked = await checkOwnerPhoto(form);
  if ("error" in checked) return invalid(checked.error);

  const current = await supabase.from("products")
    .select("id,image_url,catalogue_product_id").eq("id", productId).maybeSingle();
  if (current.error || !current.data) return invalid("Could not find this drink. Refresh and try again.");
  if (current.data.catalogue_product_id)
    return invalid("Change this picture in the master catalogue instead.");

  const path = `products/${productId}/${randomUUID()}.${checked.extension}`;
  try {
    const upload = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, checked.bytes, {
      contentType: checked.mime, cacheControl: "31536000", upsert: false,
    });
    if (upload.error) return invalid("Photo upload failed. Please try again.");

    const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
    let request = supabase.from("products").update({ image_url: data.publicUrl }).eq("id", productId);
    request = current.data.image_url
      ? request.eq("image_url", current.data.image_url)
      : request.is("image_url", null);
    const updated = await request.select("id").maybeSingle();
    if (updated.error || !updated.data) {
      await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
      return invalid("Another picture was saved first. Refresh and try again.");
    }
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    revalidatePath("/stock");
    revalidatePath("/stock/count");
    revalidatePath("/stock/receive");
    revalidatePath("/record-sale");
    return { message: "Picture saved for this drink.", saved: true };
  } catch {
    return invalid("Could not finish uploading. Refresh to check before trying again.");
  }
}
