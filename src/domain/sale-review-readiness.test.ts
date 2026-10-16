import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewConfirmationIssue } from "./sale-review-readiness.ts";

const valid = {
  ready: true,
  checkError: "",
  businessDate: "2026-10-16",
  reviewTotal: 12000,
  hasEmptiesReview: true,
  emptiesNeedConfirmation: false,
  emptiesUnmatched: false,
  paid: 12000,
  debtChecking: false,
  debtErrorMessage: "",
  oldDebtInputError: null,
  hasPaymentBreakdown: true,
  collectNow: 12000,
  paymentMethod: "transfer",
};

test("valid, fully checked sale can continue to final confirmation", () => {
  assert.equal(reviewConfirmationIssue(valid), null);
});
test("an unverified balance on restored Review has visible retry guidance", () => {
  assert.equal(reviewConfirmationIssue({ ...valid, debtChecking: true })?.action, "check_balance");
  assert.equal(reviewConfirmationIssue({ ...valid, debtErrorMessage: "Try again" })?.message, "Try again");
});
test("expired catalogue, missing date and invalid paid amount have concrete repairs", () => {
  assert.equal(reviewConfirmationIssue({ ...valid, ready: false, checkError: "Stock unavailable" })?.action, "check_prices");
  assert.equal(reviewConfirmationIssue({ ...valid, businessDate: "" })?.action, "edit_date");
  assert.equal(reviewConfirmationIssue({ ...valid, reviewTotal: undefined })?.action, "edit_drinks");
  assert.equal(reviewConfirmationIssue({ ...valid, paid: 15000 })?.action, "edit_payment");
});
test("empty-return mismatches and payment errors can no longer silently disable final Review", () => {
  for (const flags of [
    { hasEmptiesReview: false },
    { emptiesNeedConfirmation: true },
    { emptiesUnmatched: true },
  ]) assert.equal(reviewConfirmationIssue({ ...valid, ...flags })?.action, "edit_empties");
  assert.equal(reviewConfirmationIssue({ ...valid, oldDebtInputError: "Old debt changed" })?.action, "edit_payment");
  assert.equal(reviewConfirmationIssue({ ...valid, hasPaymentBreakdown: false })?.action, "check_balance");
  assert.equal(reviewConfirmationIssue({ ...valid, paymentMethod: "" })?.action, "edit_payment");
  assert.equal(reviewConfirmationIssue({ ...valid, paid: 0, collectNow: 0, paymentMethod: "" }), null);
});
