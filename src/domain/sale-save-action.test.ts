import assert from "node:assert/strict";
import { test } from "node:test";
import { blockSaleSaveAction, visibleSaleStep } from "./sale-save-action.ts";

const valid = {
  pending: false, saveUncertain: false, ready: true,
  hasBusinessDate: true, reviewedTotalAvailable: true,
  emptiesValid: true, paidWithinTotal: true, paymentValid: true,
};

test("ordinary Save remains blocked until all amounts, empties, date and catalogue are validated", () => {
  assert.equal(blockSaleSaveAction(valid), false);
  for (const key of [
    "ready", "hasBusinessDate", "reviewedTotalAvailable",
    "emptiesValid", "paidWithinTotal", "paymentValid",
  ] as const) {
    assert.equal(blockSaleSaveAction({ ...valid, [key]: false }), true, key);
  }
  assert.equal(blockSaleSaveAction({ ...valid, pending: true }), true);
});

test("read-only Check Sale is always available for uncertain writes, even with missing prices, old debt and empties", () => {
  const broken = {
    ...valid, saveUncertain: true, ready: false,
    hasBusinessDate: false, reviewedTotalAvailable: false,
    emptiesValid: false, paidWithinTotal: false, paymentValid: false,
  };
  assert.equal(blockSaleSaveAction(broken), false);
  assert.equal(blockSaleSaveAction({ ...broken, pending: true }), true,
    "an in-flight status check must prevent duplicate taps");
});

test("missing or archived customer cannot hide a pending Check Sale", () => {
  assert.equal(visibleSaleStep({
    customerAvailable: false, saveUncertain: true, draftStep: "review",
  }), "review");
  assert.equal(visibleSaleStep({
    customerAvailable: false, saveUncertain: false, draftStep: "review",
  }), "customer");
  assert.equal(visibleSaleStep({
    customerAvailable: false, saveUncertain: true, draftStep: "payment",
  }), "customer", "do not bypass the ordinary customer prerequisite");
  assert.equal(visibleSaleStep({
    customerAvailable: true, saveUncertain: false, draftStep: "payment",
  }), "payment");
});
