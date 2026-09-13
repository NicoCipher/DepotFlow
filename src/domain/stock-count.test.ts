import assert from "node:assert/strict";
import { test } from "node:test";
import { stockCountPreview, validateBusinessDate } from "./stock-count.ts";

test("current count uses product crate size and replaces rather than adds", () => {
  assert.equal(
    stockCountPreview("13", "5", "2026-09-01", 1000, 12).stockAfter,
    161,
  );
  assert.equal(
    stockCountPreview("2", "5", "2026-09-01", 1000, 24).stockAfter,
    53,
  );
  assert.equal(
    stockCountPreview("0", "9", "2026-09-01", 1000, 12).stockAfter,
    9,
  );
  assert.equal(
    stockCountPreview("0", "0", "2026-09-01", 1000, 12).stockAfter,
    0,
  );
});
test("count rejects invalid crates and loose bottles, including a whole crate remainder", () => {
  for (const bad of ["", "-1", "1.5", "NaN", "Infinity", "1e2", "2147483648"]) {
    assert.throws(() => stockCountPreview(bad, "0", "2026-09-01", 0, 12));
    assert.throws(() => stockCountPreview("0", bad, "2026-09-01", 0, 12));
  }
  assert.throws(
    () => stockCountPreview("1", "12", "2026-09-01", 0, 12),
    /fewer/,
  );
  assert.throws(
    () => stockCountPreview("2147483647", "0", "2026-09-01", 0, 12),
    /limit/,
  );
});
test("business dates are explicit calendar dates, including leap years", () => {
  for (const valid of ["2024-02-29", "2026-09-01", "0001-01-01", "9999-12-31"])
    assert.equal(validateBusinessDate(valid), valid);
  for (const bad of [
    "",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026-1-1",
    "today",
    "2026-09-01T00:00:00Z",
  ])
    assert.throws(() => validateBusinessDate(bad), /valid business date/);
  assert.throws(() => stockCountPreview("1", "0", "2026-02-29", 0, 12));
});
