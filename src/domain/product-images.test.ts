import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogueImageUrl,
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
