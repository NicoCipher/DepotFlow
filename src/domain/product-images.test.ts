import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogueImageUrl,
  currentProductImage,
  validCatalogueImagePath,
  sniffProductImage,
  trustedProductImageUrl,
} from "./product-images.ts";

const uuid = "a5a88718-5fb3-488f-aea4-5271e535607e";
const path = `catalogue/${uuid}/${uuid}.webp`;

test("only bucket-managed catalogue photos can be displayed", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://my-project.supabase.co";
  assert.equal(validCatalogueImagePath(path), true);
  assert.equal(catalogueImageUrl(path), `https://my-project.supabase.co/storage/v1/object/public/product-images/${path}`);
  assert.equal(trustedProductImageUrl(catalogueImageUrl(path)), true);
  assert.equal(trustedProductImageUrl(`https://my-project.supabase.co/storage/v1/object/public/product-images/products/${uuid}/${uuid}.png`), true);
  assert.equal(trustedProductImageUrl("https://example.com/image.png"), false);
  assert.equal(trustedProductImageUrl("https://my-project.supabase.co/storage/v1/object/public/other/private.png"), false);
  assert.equal(validCatalogueImagePath("../private.png"), false);
  assert.equal(trustedProductImageUrl(`https://my-project.supabase.co/storage/v1/object/public/product-images/${path}?redirect=https://evil.com`), false);
});

test("file signature must match the allowed MIME type", () => {
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0]);
  assert.equal(sniffProductImage(png, "image/png"), "png");
  assert.equal(sniffProductImage(png, "image/jpeg"), null);
  assert.equal(sniffProductImage(new Uint8Array([255,216,255,0]), "image/jpeg"), "jpg");
  assert.equal(sniffProductImage(new TextEncoder().encode("<svg></svg>"), "image/png"), null);
  assert.equal(sniffProductImage(new TextEncoder().encode("<html></html>"), "image/webp"), null);
});


test("only same-site bundled packshots are accepted, never third-party URLs", () => {
  assert.equal(trustedProductImageUrl("/catalogue-photos/goldberg-60cl.webp"), true);
  assert.equal(trustedProductImageUrl("/catalogue-photos/33-export.webp"), true);
  assert.equal(trustedProductImageUrl("https://products.contact/photo.jpg"), false);
  assert.equal(trustedProductImageUrl("//evil.com/catalogue-photos/goldberg-60cl.webp"), false);
  assert.equal(trustedProductImageUrl("/catalogue-photos/../../secret.webp"), false);
  assert.equal(trustedProductImageUrl("/catalogue-photos/goldberg-60cl.webp?redirect=evil"), false);
  assert.equal(trustedProductImageUrl("/catalogue-photos/goldberg-60cl.webp#fragment"), false);
  assert.equal(trustedProductImageUrl("/some-other-file.webp"), false);
});

test("a first-party catalogue photo resolves locally and never hotlinks the source", () => {
  const imagePath = "first-party/goldberg-60cl.webp";
  assert.equal(validCatalogueImagePath(imagePath), true);
  assert.equal(catalogueImageUrl(imagePath), "/catalogue-photos/goldberg-60cl.webp");
  assert.equal(validCatalogueImagePath("first-party/../secret.webp"), false);
  assert.equal(validCatalogueImagePath("first-party/goldberg-60cl.svg"), false);
  assert.equal(validCatalogueImagePath("https://retailer.com/goldberg.webp"), false);
});

test("shared master photo wins over another depot's stale cached image", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://my-project.supabase.co";
  const cached = "/catalogue-photos/old-goldberg.webp";
  const item = { image_url: cached, product_catalogue: { image_path: path } };
  assert.equal(
    currentProductImage(item),
    `https://my-project.supabase.co/storage/v1/object/public/product-images/${path}`,
  );
  assert.equal(
    currentProductImage({ image_url: cached, product_catalogue: { image_path: "first-party/new-goldberg.webp" } }),
    "/catalogue-photos/new-goldberg.webp",
  );
  // Removing a master photo is a meaningful change, not a missing join:
  // every linked depot must stop showing its historical cached image.
  assert.equal(
    currentProductImage({ image_url: cached, product_catalogue: { image_path: null } }),
    null,
  );
  assert.equal(
    currentProductImage({ image_url: cached, product_catalogue: { image_path: "" } }),
    null,
  );
  assert.equal(
    currentProductImage({ image_url: cached, product_catalogue: null }),
    cached,
  );
  assert.equal(
    currentProductImage({ image_url: cached }),
    cached,
  );
  assert.equal(
    currentProductImage({ image_url: cached, product_catalogue: { image_path: "https://evil.example/track.png" } }),
    null,
  );
});
