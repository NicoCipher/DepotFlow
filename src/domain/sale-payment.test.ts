import assert from "node:assert/strict";
import { test } from "node:test";
import { debtPaymentInputError, salePaymentTotals, paymentReviewIssue, needsClearHiddenOldDebtPayment, splitTenderShortfallChoices, splitPaymentFromReceived, oneMethodAmountsFromReceived } from "./sale-payment.ts";

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

test("cash plus transfer checkout shows actionable Review errors until tender totals match", () => {
  const base = {
    saleTotal: 1700, paymentInputError: "", oldDebtInputError: null,
    oldDebtAmount: 0, oldDebtPaid: "0", debtChecking: false,
    debtErrorMessage: "", breakdown: salePaymentTotals(1700, 1700, 0, 0),
    paymentMethod: "mixed", paymentMode: "split" as const,
    salePaid: "1700", splitCash: "700", splitTransfer: "1000",
    splitCashToSale: "", splitEnabled: true,
  };
  assert.equal(paymentReviewIssue(base), null);
  assert.equal(paymentReviewIssue({ ...base, splitEnabled: false })?.target, "sale-method");
  assert.equal(paymentReviewIssue({ ...base, splitTransfer: "900" })?.target, "sale-split-payment");
  assert.equal(paymentReviewIssue({ ...base, splitCash: "0" })?.target, "sale-split-payment");
  assert.equal(paymentReviewIssue({ ...base, splitCash: "700.5" })?.target, "sale-split-payment");
  assert.equal(paymentReviewIssue({ ...base, splitCashToSale: "701" })?.target, "sale-split-payment");
  assert.equal(paymentReviewIssue({ ...base, salePaid: "0",
    breakdown: salePaymentTotals(1700, 0, 0, 0), splitCash: "0", splitTransfer: "0" })?.target, "sale-split-payment");
});
test("customer old-debt split can send Cash to previous debt and Transfer to sale", () => {
  const input = {
    saleTotal: 1500, paymentInputError: "", oldDebtInputError: null,
    oldDebtAmount: 500, oldDebtPaid: "500", debtChecking: false,
    debtErrorMessage: "", breakdown: salePaymentTotals(1500, 1500, 500, 500),
    paymentMethod: "mixed", paymentMode: "split" as const,
    salePaid: "1500", splitCash: "500", splitTransfer: "1500",
    splitCashToSale: "0", splitEnabled: true,
  };
  assert.equal(paymentReviewIssue(input), null);
});

test("5000 collected instead of 5250 offers an explicit partial sale payment", () => {
  const plan = splitTenderShortfallChoices({
    saleTotal: 5250, salePaid: "5250", oldDebt: 2200, oldDebtPaid: "0",
    cash: "3000", transfer: "2000", cashToSale: "",
  });
  assert.deepEqual(plan, {
    received: 5000, shortfall: 250,
    choices: [{ appliesTo: "sale", salePaid: 5000, oldDebtPaid: 0, saleUnpaid: 250, oldDebtLeft: 2200 }],
  });
  assert.deepEqual(salePaymentTotals(5250, plan!.choices[0].salePaid, 2200, 0), {
    oldDebtRemaining: 2200, saleRemaining: 250, collectNow: 5000, totalOwedAfter: 2450,
  });
});

test("split shortfall never silently decides to reduce a previous debt payment", () => {
  const plan = splitTenderShortfallChoices({
    saleTotal: 5250, salePaid: "3500", oldDebt: 2200, oldDebtPaid: "1750",
    cash: "3000", transfer: "2000", cashToSale: "",
  });
  assert.equal(plan?.shortfall, 250);
  assert.deepEqual(plan?.choices, [
    { appliesTo: "sale", salePaid: 3250, oldDebtPaid: 1750, saleUnpaid: 2000, oldDebtLeft: 450 },
    { appliesTo: "oldDebt", salePaid: 3500, oldDebtPaid: 1500, saleUnpaid: 1750, oldDebtLeft: 700 },
  ]);
});

test("short split payment suggestions fail closed for invalid inputs or custom cash allocations", () => {
  const base = {
    saleTotal: 5250, salePaid: "5250", oldDebt: 2200,
    oldDebtPaid: "0", cash: "3000", transfer: "2000", cashToSale: "",
  };
  assert.equal(splitTenderShortfallChoices({ ...base, cash: "3k" }), null);
  assert.equal(splitTenderShortfallChoices({ ...base, transfer: "0" }), null);
  assert.equal(splitTenderShortfallChoices({ ...base, cash: "3250" }), null, "exact money needs no correction");
  assert.equal(splitTenderShortfallChoices({ ...base, cash: "4000" }), null, "overpayment must not be silently allocated");
  assert.equal(splitTenderShortfallChoices({ ...base, cashToSale: "5250" }), null, "incompatible custom allocation gets no shortcut");
  assert.deepEqual(splitTenderShortfallChoices({ ...base, oldDebt: null })?.choices[0].oldDebtLeft, null);
});

test("Cash 3000 plus Transfer 2000 immediately pays 5000 of a 5250 sale", () => {
  const result = splitPaymentFromReceived({
    saleTotal: 5250, cash: "3000", transfer: "2000",
    oldDebt: 2200, oldDebtPaid: "0",
  });
  assert.deepEqual(result, {
    received: 5000, salePaid: 5000, oldDebtPaid: 0, extraForOldDebt: 0, issue: null,
  });
  assert.deepEqual(salePaymentTotals(5250, result.salePaid!, 2200, 0), {
    collectNow: 5000, saleRemaining: 250, oldDebtRemaining: 2200, totalOwedAfter: 2450,
  });
});

test("Cash + Transfer respects an explicitly chosen old-debt allocation", () => {
  const result = splitPaymentFromReceived({
    saleTotal: 5250, cash: "3000", transfer: "2000",
    oldDebt: 2200, oldDebtPaid: "1500",
  });
  assert.equal(result.issue, null);
  assert.equal(result.salePaid, 3500);
  assert.deepEqual(salePaymentTotals(5250, result.salePaid!, 2200, result.oldDebtPaid!), {
    collectNow: 5000, saleRemaining: 1750, oldDebtRemaining: 700, totalOwedAfter: 2450,
  });
});

test("Cash + Transfer never silently allocates a surplus to previous debt", () => {
  const result = splitPaymentFromReceived({
    saleTotal: 5250, cash: "4000", transfer: "2000",
    oldDebt: 2200, oldDebtPaid: "0",
  });
  assert.equal(result.received, 6000);
  assert.equal(result.salePaid, null);
  assert.equal(result.extraForOldDebt, 750);
  assert.match(result.issue ?? "", /exceeds today's sale/);
  const accepted = splitPaymentFromReceived({
    saleTotal: 5250, cash: "4000", transfer: "2000",
    oldDebt: 2200, oldDebtPaid: "750",
  });
  assert.equal(accepted.issue, null);
  assert.equal(accepted.salePaid, 5250);
});

test("Cash + Transfer entry fails closed on invalid or excess allocations", () => {
  const base = {
    saleTotal: 5250, cash: "3000", transfer: "2000",
    oldDebt: 2200, oldDebtPaid: "0",
  };
  for (const raw of ["", "1.2", "-1", "2,000", "NaN"]) {
    assert.notEqual(splitPaymentFromReceived({ ...base, cash: raw }).issue, null);
  }
  assert.notEqual(splitPaymentFromReceived({ ...base, oldDebtPaid: "6000" }).issue, null);
  assert.notEqual(splitPaymentFromReceived({ ...base, oldDebtPaid: "2400" }).issue, null);
  assert.notEqual(splitPaymentFromReceived({ ...base, oldDebt: null, oldDebtPaid: "500" }).issue, null);
  assert.equal(splitPaymentFromReceived({ ...base, oldDebt: null }).salePaid, 5000);
  assert.notEqual(splitPaymentFromReceived({ ...base, transfer: "2147483647" }).issue, null);
  assert.equal(splitPaymentFromReceived({ ...base, cash: "0", transfer: "0" }).salePaid, 0,
    "Zero is previewable, but split saving still requires both positive methods.");
});

test("split payment review explains input mistakes directly", () => {
  const base = {
    saleTotal: 5250, paymentInputError: "", oldDebtInputError: null,
    oldDebtAmount: 2200, oldDebtPaid: "0", debtChecking: false,
    debtErrorMessage: "", breakdown: null, paymentMethod: "mixed",
    paymentMode: "split" as const, splitEnabled: true,
    salePaid: "0", splitCash: "3000", splitTransfer: "2000",
    splitCashToSale: "", splitEntryIssue: "The received amount exceeds today's sale.",
  };
  assert.equal(paymentReviewIssue(base)?.target, "sale-split-payment");
  assert.match(paymentReviewIssue(base)?.message ?? "", /received amount/);
});

test("one-method conversion replaces stale split draft money rather than retaining planned values", () => {
  const received = splitPaymentFromReceived({
    saleTotal: 5250, cash: "5000", transfer: "0", oldDebt: 2200, oldDebtPaid: "0",
  });
  assert.deepEqual(oneMethodAmountsFromReceived(received), { paid: "5000", oldDebtPaid: "0" });
  assert.notEqual(oneMethodAmountsFromReceived(received).paid, "5250");
  const withOldDebt = splitPaymentFromReceived({
    saleTotal: 5250, cash: "3000", transfer: "2000", oldDebt: 2200, oldDebtPaid: "1500",
  });
  assert.deepEqual(oneMethodAmountsFromReceived(withOldDebt), { paid: "3500", oldDebtPaid: "1500" });
  const invalid = splitPaymentFromReceived({
    saleTotal: 5250, cash: "3000", transfer: "", oldDebt: 2200, oldDebtPaid: "0",
  });
  assert.deepEqual(oneMethodAmountsFromReceived(invalid), { paid: "0", oldDebtPaid: "0" });
});
