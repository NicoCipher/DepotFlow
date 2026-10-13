import assert from "node:assert/strict";
import test from "node:test";
import { prepareOwnerPhoto } from "../lib/client-product-photo.ts";

test("owner photographs under 1 MiB are preserved without needless conversion", async () => {
  const photo = new File([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], "goldberg.jpg", { type: "image/jpeg" });
  assert.equal(await prepareOwnerPhoto(photo), photo);
});

test("a supported image can be submitted without leaking to external services", async () => {
  const picture = new File([Uint8Array.of(137, 80, 78, 71)], "drink.png", { type: "image/png" });
  assert.equal(await prepareOwnerPhoto(picture), picture);
});

test("never accept non-image files, even if their filename looks like a photo", async () => {
  const bad = new File(["<script>alert(1)</script>"], "goldberg.jpg", { type: "text/html" });
  await assert.rejects(() => prepareOwnerPhoto(bad), /Choose a photo from your camera/);
});

test("empty files are not accepted", async () => {
  const bad = new File([], "goldberg.jpg", { type: "image/jpeg" });
  await assert.rejects(() => prepareOwnerPhoto(bad), /Choose a photo smaller/);
});
