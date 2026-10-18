import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOpeningQuantity,
  isValidDrinkOpeningQuantity,
} from "./opening-physical-count.ts";

test("zero is a valid explicitly confirmed physical count", () => {
  assert.equal(parseOpeningQuantity("0"), 0);
  assert.equal(parseOpeningQuantity("14"), 14);
  assert.equal(isValidDrinkOpeningQuantity(0, 0, 20), true);
});

test("reject negative, decimal, scientific or excessive counts", () => {
  for (const raw of ["-1", "1.5", "2e3", "", "  ", "2147483648", "1234567890123"]) {
    assert.equal(parseOpeningQuantity(raw), null, raw);
  }
  assert.equal(parseOpeningQuantity("2147483647"), 2147483647);
});

test("reject full drink crates plus loose bottles that overflow a pack", () => {
  assert.equal(isValidDrinkOpeningQuantity(3, 4, 20), true);
  assert.equal(isValidDrinkOpeningQuantity(3, 20, 20), false);
  assert.equal(isValidDrinkOpeningQuantity(1, 1, 0), false);
  assert.equal(isValidDrinkOpeningQuantity(107374183, 0, 20), false);
  assert.equal(isValidDrinkOpeningQuantity(null, 1, 20), false);
});
