import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLimitedJson, RequestBodyTooLarge } from "./limited-json.ts";

const encoder = new TextEncoder();
function chunks(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}
test("accepts valid small JSON split over chunks", async () => {
  assert.deepEqual(await parseLimitedJson(chunks(['{"customer', 'Id":"abc"}']), 128),
    { customerId: "abc" });
});
test("rejects large single-chunk body", async () => {
  await assert.rejects(
    parseLimitedJson(chunks(['a'.repeat(1200)]), 1024), RequestBodyTooLarge,
  );
});
test("rejects cumulative chunked body without Content-Length", async () => {
  await assert.rejects(
    parseLimitedJson(chunks(['a'.repeat(500), 'b'.repeat(500), 'c'.repeat(30)]), 1024),
    RequestBodyTooLarge,
  );
});
test("rejects missing and invalid JSON", async () => {
  await assert.rejects(parseLimitedJson(null), /Missing JSON/);
  await assert.rejects(parseLimitedJson(chunks(['{bad']), 1024), SyntaxError);
});
