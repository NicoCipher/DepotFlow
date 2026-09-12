import assert from "node:assert/strict";
import { test } from "node:test";
import { formatQuantity, splitBottles, toBottles, validateStock } from "./quantity.ts";

test("crate conversion uses each product's crate size", () => {
  assert.equal(toBottles(1, 12), 12);
  assert.equal(toBottles(1, 24), 24);
});
test("half and quarter crates produce whole bottles", () => {
  assert.equal(toBottles(1.5, 12), 18);
  assert.equal(toBottles(1.75, 12), 21);
  assert.equal(toBottles(0.25, 24), 6);
  assert.throws(() => toBottles(0.25, 10), RangeError);
});
test("arbitrary crates and loose bottles are supported", () => {
  assert.equal(toBottles(13, 12), 156);
  assert.equal(toBottles(2, 12, 5), 29);
  assert.equal(toBottles(0, 12, 9), 9);
  assert.deepEqual(splitBottles(21, 12), { crates: 1, bottles: 9 });
  assert.deepEqual(splitBottles(156, 12), { crates: 13, bottles: 0 });
});
test("display handles remainders, singulars, and zero", () => {
  assert.equal(formatQuantity(29, 12), "2 crates + 5 bottles");
  assert.equal(formatQuantity(21, 12), "1 crate + 9 bottles");
  assert.equal(formatQuantity(12, 12), "1 crate");
  assert.equal(formatQuantity(1, 12), "1 bottle");
  assert.equal(formatQuantity(0, 12), "0 bottles");
});
test("stock accepts the maximum and rejects excess and empty orders", () => {
  assert.deepEqual(validateStock(24, 24), { valid: true });
  assert.equal(validateStock(25, 24).valid, false);
  assert.equal(validateStock(1, 0).valid, false);
  assert.equal(validateStock(0, 24).valid, false);
});
test("invalid numbers and unsafe totals are rejected", () => {
  for (const value of [-1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => splitBottles(value, 12), RangeError);
    assert.throws(() => validateStock(value, 12), RangeError);
    assert.throws(() => validateStock(1, value), RangeError);
  }
  for (const size of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => toBottles(1, size), RangeError);
  assert.throws(() => toBottles(-1, 12), RangeError);
  assert.throws(() => toBottles(Number.MAX_SAFE_INTEGER, 12), RangeError);
});
