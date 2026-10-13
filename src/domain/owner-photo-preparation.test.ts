import assert from "node:assert/strict";
import test from "node:test";
import { prepareOwnerPhoto } from "../lib/client-product-photo.ts";

test("owner photos are always re-encoded to prevent EXIF/GPS leakage", async () => {
  const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let bitmapClosed = false;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 320, height: 480, close: () => { bitmapClosed = true; } }),
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
      toBlob: (callback: (blob: Blob) => void, mime: string) =>
        callback(new Blob(["RIFFxxxxWEBPmock"], { type: mime })),
    }) },
  });
  try {
    const original = new File([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], "goldberg.jpg", { type: "image/jpeg" });
    const output = await prepareOwnerPhoto(original);
    assert.notEqual(output, original);
    assert.equal(output.type, "image/webp");
    assert.equal(output.name, "owner-drink-photo.webp");
    assert.ok(output.size > 0 && output.size < 1024 * 1024);
    assert.equal(bitmapClosed, true);
  } finally {
    if (previousBitmap) Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("non-image files are rejected even with a .jpg filename", async () => {
  const bad = new File(["<script>alert(1)</script>"], "goldberg.jpg", { type: "text/html" });
  await assert.rejects(() => prepareOwnerPhoto(bad), /Choose a photo from your camera/);
});

test("empty files are rejected", async () => {
  const bad = new File([], "goldberg.jpg", { type: "image/jpeg" });
  await assert.rejects(() => prepareOwnerPhoto(bad), /Choose a photo smaller/);
});
