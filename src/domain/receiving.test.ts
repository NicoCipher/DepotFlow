import assert from "node:assert/strict";
import { test } from "node:test";
import { receivingPreview } from "./receiving.ts";
const snapshot = {
  stock: 5,
  empties: 10,
  bottlesPerCrate: 12,
  crateType: "exact-type",
  crateTypeId: "50000000-0000-4000-8000-000000000001",
};
test("receiving adds crates to existing bottles and removes exactly that many empty crates", () => {
  assert.deepEqual(receivingPreview("2", snapshot), {
    ...snapshot,
    crates: 2,
    stockAfter: 29,
    emptiesAfter: 8,
  });
  assert.equal(
    receivingPreview("2", { ...snapshot, bottlesPerCrate: 24 }).stockAfter,
    53,
  );
  assert.equal(receivingPreview("10", snapshot).emptiesAfter, 0);
});
test("insufficient exact-type empties are rejected", () => {
  assert.throws(() => receivingPreview("11", snapshot), /Not enough/);
  assert.throws(
    () => receivingPreview("1", { ...snapshot, empties: 0 }),
    /Not enough/,
  );
});
test("zero, negative, fractional and invalid crates are rejected", () => {
  for (const raw of [
    "0",
    "-1",
    "1.5",
    "1e2",
    "",
    "NaN",
    "Infinity",
    "2147483648",
  ])
    assert.throws(() => receivingPreview(raw, snapshot));
});
test("overflow and corrupt counts cannot become a review", () => {
  assert.throws(
    () => receivingPreview("1", { ...snapshot, stock: 2147483647 }),
    /limit/,
  );
  assert.throws(() => receivingPreview("1", { ...snapshot, stock: -1 }));
  assert.throws(() =>
    receivingPreview("1", { ...snapshot, bottlesPerCrate: 0 }),
  );
});
