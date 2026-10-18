import assert from "node:assert/strict";
import test from "node:test";
import {
  businessDateInLagos,
  validCapturedOpeningDate,
} from "./opening-business-date.ts";

test("captures Lagos calendar date across midnight in WAT", () => {
  const before = new Date("2026-10-18T22:30:00Z");
  const after = new Date("2026-10-18T23:30:00Z");
  assert.equal(businessDateInLagos(before), "2026-10-18");
  assert.equal(businessDateInLagos(after), "2026-10-19");

  // A count form rendered before midnight keeps its original date for
  // retry after midnight; the RPC compares immutable request_payload.
  const firstDate = businessDateInLagos(before);
  assert.equal(validCapturedOpeningDate(firstDate, after), true);
  assert.equal(firstDate, "2026-10-18");
});

test("opening count date must be a real nonfuture ISO day", () => {
  const now = new Date("2026-10-18T22:30:00Z");
  for (const wrong of [
    null, "", "2026-02-30", "2026-10-19", "2026-10-18T00:00:00Z",
    "2026/10/18", "18-10-2026", "invalid",
  ]) {
    assert.equal(validCapturedOpeningDate(wrong, now), false, String(wrong));
  }
  assert.equal(validCapturedOpeningDate("2026-10-18", now), true);
});
