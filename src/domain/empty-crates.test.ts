import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCrateQuantity, emptyCrateCountPreview } from "./empty-crates.ts";

test("unrecorded empty crates stay distinct from confirmed zero", () => {
  assert.equal(emptyCrateQuantity(null), "Not recorded");
  assert.equal(emptyCrateQuantity(0), "0 crates");
  assert.equal(emptyCrateQuantity(1), "1 crate");
  assert.equal(emptyCrateQuantity(13), "13 crates");
});
test("initial, positive and zero empty-crate counts are replacement totals", () => {
  assert.deepEqual(emptyCrateCountPreview("13", "2026-09-01", null), {
    quantity: 13,
    businessDate: "2026-09-01",
    previousQuantity: null,
  });
  assert.equal(emptyCrateCountPreview(" 5 ", "2026-09-01", 13).quantity, 5);
  assert.equal(emptyCrateCountPreview("0", "2026-09-01", 13).quantity, 0);
  assert.equal(
    emptyCrateCountPreview("2147483647", "2026-09-01", 0).quantity,
    2147483647,
  );
});
test("empty-crate count rejects invalid, negative, fractional and overflowing quantities", () => {
  for (const value of [
    "",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "1e2",
    "2147483648",
    "1 crate",
  ])
    assert.throws(
      () => emptyCrateCountPreview(value, "2026-09-01", null),
      /whole number/,
    );
  for (const value of [-1, 1.5, NaN, Infinity, 2147483648])
    assert.throws(() => emptyCrateQuantity(value));
});
test("empty-crate count requires a real explicit business date", () => {
  for (const date of [
    "",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026-1-1",
  ])
    assert.throws(
      () => emptyCrateCountPreview("1", date, null),
      /business date/,
    );
  assert.equal(
    emptyCrateCountPreview("1", "2024-02-29", 0).businessDate,
    "2024-02-29",
  );
});
