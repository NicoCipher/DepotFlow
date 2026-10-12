"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_BUCKET,
  sniffProductImage,
} from "@/domain/product-images";

export type PhotoState = { message: string; saved: boolean };

/** Never fetch third-party image URLs: upload only files submitted by the shop owner. */
export async function uploadCataloguePhoto(
  catalogueId: string,
  _previous: PhotoState,
  form: FormData,
): Promise<PhotoState> {
  const supabase = await requireOwner();
  const invalid = (message: string): PhotoState => ({ message, saved: false });
  if (!isProductId(catalogueId)) return invalid("Choose this drink again.");
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_PRODUCT_IMAGE_BYTES)
    return invalid("Choose a JPG, PNG, or WebP picture smaller than 1 MB.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = sniffProductImage(bytes, file.type);
  if (!extension) return invalid("This file is not a valid JPG, PNG, or WebP picture.");
  const catalogue = await supabase.from("product_catalogue")
    .select("id,image_path").eq("id", catalogueId).maybeSingle();
  if (catalogue.error || !catalogue.data)
    return invalid("This drink could not be found. Refresh and try again.");

  const path = `catalogue/${catalogueId}/${randomUUID()}.${extension}`;
  try {
    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, bytes, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) return invalid("Photo upload failed. Please try again.");

    // Prevent stale simultaneous updates from silently replacing another photo.
    let update = supabase.from("product_catalogue")
      .update({ image_path: path }).eq("id", catalogueId);
    update = catalogue.data.image_path
      ? update.eq("image_path", catalogue.data.image_path)
      : update.is("image_path", null);
    const changed = await update.select("id").maybeSingle();
    if (changed.error || !changed.data) {
      await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
      return invalid("Another photo was saved first. Refresh before uploading again.");
    }

    const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
    const sync = await supabase.from("products")
      .update({ image_url: data.publicUrl })
      .eq("catalogue_product_id", catalogueId);
    revalidatePath("/products/catalogue");
    revalidatePath("/products");
    revalidatePath("/stock");
    revalidatePath("/stock/count");
    revalidatePath("/stock/receive");
    revalidatePath("/record-sale");
    if (sync.error) {
      // The catalogue image is saved; never delete the live object on a partial failure.
      return invalid("Photo saved in the catalogue, but the shop picture could not update. Please contact support.");
    }
    return { message: "Photo saved. It will appear in your shop and sales.", saved: true };
  } catch {
    return invalid("Could not finish uploading. Refresh to check before trying again.");
  }
}
