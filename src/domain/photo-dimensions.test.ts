import assert from "node:assert/strict";
import test from "node:test";
import { imageHeaderDimensions } from "./photo-dimensions.ts";

test("reads PNG dimensions without decoding pixels", () => {
  const bytes = new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10], 0);
  bytes.set([73,72,68,82], 12);
  bytes.set([0,0,11,184,0,0,15,160], 16); // 3000 × 4000
  assert.deepEqual(imageHeaderDimensions(bytes), { width: 3000, height: 4000 });
});

test("reads standard JPEG SOF dimensions without full decode", () => {
  const bytes = new Uint8Array([255,216,255,192,0,11,8,0,4,0,6,1,1,17,0,255,217]);
  assert.deepEqual(imageHeaderDimensions(bytes), { width: 6, height: 4 });
});

test("reads WebP extended canvas dimensions", () => {
  const bytes = new Uint8Array(30);
  bytes.set([82,73,70,70],0); // RIFF
  bytes.set([87,69,66,80],8); // WEBP
  bytes.set([86,80,56,88],12); // VP8X
  bytes.set([7,0,0,15,0,0],24); // 8 x 16
  assert.deepEqual(imageHeaderDimensions(bytes), { width: 8, height: 16 });
});

test("rejects malformed or unknown headers safely", () => {
  assert.equal(imageHeaderDimensions(new Uint8Array(0)), null);
  assert.equal(imageHeaderDimensions(new Uint8Array([255,216,255,192])), null);
  assert.equal(imageHeaderDimensions(new Uint8Array(30)), null);
});
