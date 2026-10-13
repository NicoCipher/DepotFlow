/** Product photos are stored in DepotFlow's own image bucket, never hotlinked. */
export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_BYTES = 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp("^(catalogue|products)/" + UUID + "/" + UUID + "\\.(webp|png|jpg|jpeg)$", "i");

const PUBLIC_PREFIX = "/storage/v1/object/public/product-images/";

export function validCatalogueImagePath(path: string | null): path is string {
  return typeof path === "string" && path.startsWith("catalogue/") && PATH.test(path);
}

export function catalogueImageUrl(path: string | null): string | null {
  if (!validCatalogueImagePath(path)) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const project = new URL(base);
    if (!["https:", "http:"].includes(project.protocol)) return null;
    return new URL(PUBLIC_PREFIX + path, project).toString();
  } catch {
    return null;
  }
}

// First-party, build-bundled product packshots live on DepotFlow's own origin.
// This accepts no external host, query string, fragment or user-supplied path.
const OWNED_PACKSHOT = /^\/catalogue-photos\/[a-z0-9][a-z0-9-]*\.(webp|png|jpg)$/;

export function trustedProductImageUrl(value: string | null): boolean {
  if (!value) return false;
  if (OWNED_PACKSHOT.test(value)) return true;
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) return false;
  try {
    const project = new URL(projectUrl);
    const image = new URL(value);
    return image.origin === project.origin &&
      image.protocol === project.protocol &&
      !image.username && !image.password && !image.search && !image.hash &&
      image.pathname.startsWith(PUBLIC_PREFIX) &&
      PATH.test(image.pathname.slice(PUBLIC_PREFIX.length));
  } catch {
    return false;
  }
}

export function sniffProductImage(bytes: Uint8Array, declaredMime: string): "webp" | "png" | "jpg" | null {
  if (declaredMime === "image/png" && bytes.length >= 8 &&
    [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return "png";
  if (declaredMime === "image/jpeg" && bytes.length >= 3 &&
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (declaredMime === "image/webp" && bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}
