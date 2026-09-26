import assert from "node:assert/strict";
import { test } from "node:test";
import { stockDescription } from "./stock.ts";

test("stock uses each product's crate size and retains loose bottles", () => {
  assert.equal(stockDescription(29, 12), "Available: 2 crates + 5 bottles");
  assert.equal(stockDescription(29, 24), "Available: 1 crate + 5 bottles");
  assert.equal(stockDescription(21, 12), "Available: 1 crate + 9 bottles");
  assert.equal(stockDescription(156, 12), "Available: 13 crates");
  assert.equal(stockDescription(9, 12), "Available: 9 bottles");
});
test("missing stock is distinct from confirmed zero", () => {
  assert.equal(stockDescription(null, 12), "Stock not recorded");
  assert.equal(stockDescription(0, 12), "Out of stock");
});
test("invalid stock is rejected instead of displayed or silently clamped", () => {
  for (const quantity of [
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => stockDescription(quantity, 12), RangeError);
  }
  assert.throws(() => stockDescription(12, 0), RangeError);
});
