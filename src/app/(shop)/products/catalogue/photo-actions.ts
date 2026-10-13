"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { PRODUCT_IMAGE_BUCKET } from "@/domain/product-images";
import { checkOwnerPhoto } from "@/lib/product-photo-upload";

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
  const checked = await checkOwnerPhoto(form);
  if ("error" in checked) return invalid(checked.error);
  const catalogue = await supabase.from("product_catalogue")
    .select("id,image_path").eq("id", catalogueId).maybeSingle();
  if (catalogue.error || !catalogue.data)
    return invalid("This drink could not be found. Refresh and try again.");

  const path = `catalogue/${catalogueId}/${randomUUID()}.${checked.extension}`;
  try {
    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, checked.bytes, {
        contentType: checked.mime,
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) return invalid("Photo upload failed. Please try again.");

    const { data: publicUrl } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
    const committed = await supabase.rpc("set_catalogue_product_image", {
      p_catalogue_id: catalogueId,
      p_expected_path: catalogue.data.image_path,
      p_new_path: path,
      p_new_url: publicUrl.publicUrl,
    });
    if (committed.error || committed.data !== true) {
      await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
      return invalid("Picture could not be saved or another picture was saved first. Refresh and try again.");
    }
    revalidatePath("/products/catalogue");
    revalidatePath("/products");
    revalidatePath("/stock");
    revalidatePath("/stock/count");
    revalidatePath("/stock/receive");
    revalidatePath("/record-sale");
    return { message: "Photo saved. It will appear in your shop and sales.", saved: true };
  } catch {
    return invalid("Could not finish uploading. Refresh to check before trying again.");
  }
}
