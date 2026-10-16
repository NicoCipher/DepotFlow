import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldFocusSaleStep } from "./sale-step-focus.ts";

const id = "active-sale:2026-10-16";
test("refresh restoring payment step never focuses the title", () => {
  assert.equal(shouldFocusSaleStep(null, { step: "payment", activeId: id }), false);
  assert.equal(shouldFocusSaleStep(
    { step: "customer", activeId: null },
    { step: "payment", activeId: id },
  ), false);
});
test("real step navigation still focuses heading for accessibility", () => {
  assert.equal(shouldFocusSaleStep(
    { step: "empties", activeId: id },
    { step: "payment", activeId: id },
  ), true);
  assert.equal(shouldFocusSaleStep(
    { step: "payment", activeId: id },
    { step: "payment", activeId: id },
  ), false);
  assert.equal(shouldFocusSaleStep(
    { step: "payment", activeId: id },
    { step: "payment", activeId: "another-sale" },
  ), false);
});
