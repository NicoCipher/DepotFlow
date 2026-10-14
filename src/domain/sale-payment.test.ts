import assert from "node:assert/strict";
import { test } from "node:test";
import { debtPaymentInputError, salePaymentTotals } from "./sale-payment.ts";

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
