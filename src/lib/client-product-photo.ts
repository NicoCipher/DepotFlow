/**
 * Prepare a photograph taken by the owner for our 1 MiB Supabase photo bucket.
 * Runs entirely on-device; never sends an original camera image to a third party.
 */
import { MAX_PRODUCT_IMAGE_BYTES } from "../domain/product-images.ts";
import { readPhotoDimensions } from "../domain/photo-dimensions.ts";

const MAX_LOCAL_CAMERA_FILE = 30 * 1024 * 1024;
const ACCEPTED_INPUTS = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);
const OUTPUT_FORMATS = ["image/webp", "image/jpeg"] as const;

export async function prepareOwnerPhoto(file: File): Promise<File> {
  if (!file.size || file.size > MAX_LOCAL_CAMERA_FILE) {
    throw new Error("Choose a photo smaller than 30 MB.");
  }
  if (!ACCEPTED_INPUTS.has(file.type)) {
    throw new Error("Choose a photo from your camera, or a JPG, PNG, or WebP file.");
  }

  // Always re-encode camera photos to remove hidden EXIF/GPS metadata.
  // The storage bucket is publicly readable; never publish original phone metadata.

  const dimensions = await readPhotoDimensions(file);
  let decodeOptions: ImageBitmapOptions;
  if (dimensions) {
    const { width, height } = dimensions;
    if (width * height > 80_000_000 ||
        Math.max(width, height) / Math.min(width, height) > 8) {
      throw new Error("This photo is unusually large or wide. Take a normal bottle picture instead.");
    }
    // Request a *small bitmap from the decoder*, not a full-resolution
    // 48-megapixel phone image allocated in memory before canvas resizing.
    const ratio = Math.min(1, 1400 / Math.max(width, height));
    decodeOptions = {
      resizeWidth: Math.max(1, Math.round(width * ratio)),
      resizeHeight: Math.max(1, Math.round(height * ratio)),
      resizeQuality: "high",
    };
  } else {
    // HEIC/HEIF and unusual headers must also use constrained decoding.
    decodeOptions = { resizeWidth: 1000, resizeQuality: "medium" };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, decodeOptions);
  } catch {
    throw new Error("Could not safely open this picture. Try a normal JPG camera photo.");
  }

  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 6_000_000) {
      throw new Error("This photo is too large to process. Try another picture.");
    }
    const sizes = [1400, 1100, 850, 650];
    for (const longestSide of sizes) {
      const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare this photo on your device.");
      // JPEG fallback needs a solid background for any transparent picture.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const outputType of OUTPUT_FORMATS) {
        for (const quality of [0.84, 0.7, 0.55]) {
          const output = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, outputType, quality)
          );
          // Some browsers silently fall back to PNG when asked for WebP.
          if (output && output.type === outputType &&
            output.size > 0 && output.size <= MAX_PRODUCT_IMAGE_BYTES) {
            const ext = outputType === "image/webp" ? "webp" : "jpg";
            return new File([output], `owner-drink-photo.${ext}`, { type: outputType });
          }
        }
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Could not reduce the picture enough. Try taking it closer to the bottle.");
}
