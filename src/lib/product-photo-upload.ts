import "server-only";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  sniffProductImage,
} from "@/domain/product-images";

export type CheckedPhoto =
  | { error: string }
  | { bytes: Uint8Array; extension: "webp" | "png" | "jpg"; mime: string };

export async function checkOwnerPhoto(form: FormData): Promise<CheckedPhoto> {
  if (form.get("rights") !== "yes")
    return { error: "Confirm that you took the picture or have permission to use it." };
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size || file.size > MAX_PRODUCT_IMAGE_BYTES)
    return { error: "Choose a JPG, PNG, or WebP picture smaller than 1 MB." };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = sniffProductImage(bytes, file.type);
    if (!extension) return { error: "This file is not a valid JPG, PNG, or WebP picture." };
    return { bytes, extension, mime: file.type };
  } catch {
    return { error: "Could not read this picture. Please try another file." };
  }
}
