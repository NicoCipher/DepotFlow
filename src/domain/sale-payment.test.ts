import assert from "node:assert/strict";
import { test } from "node:test";
import { debtPaymentInputError, salePaymentTotals, paymentReviewIssue, needsClearHiddenOldDebtPayment } from "./sale-payment.ts";

test("old debt is settled independently of today's sale", () => {
  assert.deepEqual(salePaymentTotals(12000, 8000, 5000, 3000), {
    oldDebtRemaining: 2000,
    saleRemaining: 4000,
    collectNow: 11000,
    totalOwedAfter: 6000,
  });
});
test("paying full old debt with zero payment toward the sale", () => {
  assert.deepEqual(salePaymentTotals(10000, 0, 3000, 3000), {
    oldDebtRemaining: 0,
    saleRemaining: 10000,
    collectNow: 3000,
    totalOwedAfter: 10000,
  });
});
test("no old debt keeps existing sale behavior", () => {
  assert.deepEqual(salePaymentTotals(10000, 10000, 0, 0), {
    oldDebtRemaining: 0,
    saleRemaining: 0,
    collectNow: 10000,
    totalOwedAfter: 0,
  });
});
test("rejects overpayments and invalid amounts", () => {
  assert.throws(() => salePaymentTotals(10000, 11000, 0, 0), /sale cannot exceed/i);
  assert.throws(() => salePaymentTotals(10000, 10000, 3000, 4000), /previous debt/i);
  assert.throws(() => salePaymentTotals(10000, 0, 0, -1), /payment amounts/i);
  assert.equal(debtPaymentInputError("4000", 3000)?.includes("₦3,000"), true);
  assert.equal(debtPaymentInputError("500", null)?.includes("Check"), true);
  assert.equal(debtPaymentInputError("0", null), null);
  assert.equal(debtPaymentInputError("0.5", 3000)?.includes("whole"), true);
});

test("payment review tells the owner what blocks the next step rather than silently disabling it", () => {
  const paid = salePaymentTotals(1700, 1700, 2200, 2200);
  const base = {
    saleTotal: 1700,
    paymentInputError: "",
    oldDebtInputError: null,
    oldDebtAmount: 2200,
    oldDebtPaid: "2200",
    debtChecking: false,
    debtErrorMessage: "",
    breakdown: paid,
    paymentMethod: "",
  };
  assert.deepEqual(paid, {
    collectNow: 3900, totalOwedAfter: 0, oldDebtRemaining: 0, saleRemaining: 0,
  });
  assert.equal(paymentReviewIssue(base)?.target, "sale-method");
  assert.match(paymentReviewIssue(base)?.message ?? "", /₦3,900/);
  for (const method of ["cash", "transfer", "pos"]) {
    assert.equal(paymentReviewIssue({ ...base, paymentMethod: method }), null);
  }
  assert.equal(paymentReviewIssue({
    ...base, paymentMethod: "",
    breakdown: salePaymentTotals(1700, 0, 2200, 0),
  }), null, "pay-later reviews must not require a payment method");
  assert.equal(paymentReviewIssue({
    ...base, debtChecking: true, breakdown: null,
  })?.target, "sale-previous-debt");
  assert.equal(paymentReviewIssue({
    ...base, debtErrorMessage: "Could not verify the customer's balance",
    breakdown: null,
  })?.target, "sale-previous-debt");
  assert.equal(paymentReviewIssue({
    ...base, paymentInputError: "Enter whole numbers",
  })?.target, "sale-paid");
  assert.equal(paymentReviewIssue({
    ...base, oldDebtInputError: "Cannot overpay old debt",
  })?.target, "sale-old-debt-paid");

  assert.equal(paymentReviewIssue({
    ...base, oldDebtAmount: null, oldDebtInputError: "Check the customer's existing balance",
    debtChecking: true, breakdown: null,
  })?.target, "sale-previous-debt", "when debt is loading, focus the always-visible section");
  assert.equal(paymentReviewIssue({
    ...base, oldDebtAmount: null, oldDebtInputError: "Check the customer's existing balance",
    debtErrorMessage: "Balance could not be loaded", breakdown: null,
  })?.target, "sale-previous-debt", "balance failures should guide users to retry");
  assert.equal(paymentReviewIssue({
    ...base, oldDebtAmount: 0, oldDebtInputError: "Previous debt is ₦0. Enter that amount or less.",
    breakdown: null,
  })?.target, "sale-previous-debt", "cleared old debts hide the input but expose the clear-payment action");
  assert.equal(paymentReviewIssue({
    ...base, oldDebtAmount: 2200, oldDebtInputError: "Enter a whole amount",
    breakdown: null,
  })?.target, "sale-old-debt-paid", "nonzero loaded debt displays the editable input");
  assert.equal(paymentReviewIssue({
    ...base, saleTotal: undefined, breakdown: null,
  })?.target, "sale-paid");
});

test("a regular sale can reach server Review while independent old-debt preview is unavailable", () => {
  const base = {
    saleTotal: 12300, paymentInputError: "", oldDebtInputError: null,
    oldDebtAmount: null, oldDebtPaid: "0",
    debtChecking: true, debtErrorMessage: "",
    breakdown: salePaymentTotals(12300, 12300, 0, 0), paymentMethod: "transfer",
  };
  assert.equal(paymentReviewIssue(base), null,
    "unverified old debt should not trap a sale with no old-debt collection");
  assert.equal(paymentReviewIssue({
    ...base, debtChecking: false, debtErrorMessage: "Old balance unavailable",
  }), null, "failed preview must not block the fresh server Review check");
  assert.equal(paymentReviewIssue({
    ...base, paymentMethod: "",
  })?.target, "sale-method", "sale payments still require a valid method");
  assert.equal(paymentReviewIssue({
    ...base, oldDebtPaid: "200", breakdown: null,
    oldDebtInputError: "Check the customer's existing balance.",
  })?.target, "sale-previous-debt", "old-debt collection must stay protected");
  assert.equal(paymentReviewIssue({
    ...base, oldDebtPaid: "abc", breakdown: null,
    oldDebtInputError: "Enter a whole amount",
  })?.target, "sale-previous-debt", "corrupt old-debt input never bypasses validation");
});

test("hidden old-debt input always provides recovery for invalid and stale drafts", () => {
  for (const value of ["", "abc", " ", "-100", "0.5", "2,000", "2200", "1"]) {
    assert.equal(needsClearHiddenOldDebtPayment(value), true, `Show Clear for hidden value "${value}"`);
  }
  for (const value of ["0", "00"]) {
    assert.equal(needsClearHiddenOldDebtPayment(value), false, `Already-zero value "${value}" requires no Clear`);
  }
  // The footer guides these invalid zero-debt drafts to the always-present
  // section, where Clear is now available, rather than a missing amount input.
  const invalid = debtPaymentInputError("abc", 0);
  assert.equal(paymentReviewIssue({
    saleTotal: 1700, paymentInputError: "",
    oldDebtInputError: invalid, oldDebtAmount: 0, oldDebtPaid: "abc",
    debtChecking: false, debtErrorMessage: "",
    breakdown: null, paymentMethod: "cash",
  })?.target, "sale-previous-debt");
});
