import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseWholeNumberInput,
  wholeNumberInputMessage,
} from "./sale-input.ts";

test("whole-number input keeps blank distinct from zero", () => {
  assert.deepEqual(parseWholeNumberInput(""), { ok: false, reason: "empty" });
  assert.deepEqual(parseWholeNumberInput("   "), {
    ok: false,
    reason: "empty",
  });
  assert.deepEqual(parseWholeNumberInput("0"), { ok: true, value: 0 });
});

test("whole-number input rejects negative, decimal and non-number text", () => {
  for (const value of ["-1", "1.5", "two", "1,000"])
    assert.deepEqual(parseWholeNumberInput(value), {
      ok: false,
      reason: "format",
    });
});

test("whole-number input returns field-friendly messages", () => {
  assert.equal(
    wholeNumberInputMessage("", "Trophy crates returned"),
    "Enter Trophy crates returned, or 0.",
  );
  assert.equal(
    wholeNumberInputMessage("2.5", "Trophy crates returned"),
    "Use a whole number for Trophy crates returned.",
  );
  assert.equal(
    wholeNumberInputMessage("4", "physical crates taken", {
      max: 3,
      maxMessage: "This sale has only 3 whole crates.",
    }),
    "This sale has only 3 whole crates.",
  );
});
