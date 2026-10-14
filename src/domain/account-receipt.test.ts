import assert from "node:assert/strict";
import { test } from "node:test";
import { readAccountReceipt } from "./account-receipt.ts";

test("historical statement shows B/D, both allocations and exact C/D", () => {
  const snapshot = { bd: 5000, saleTotal: 12000, paidOld: 3000, paidSale: 8000, collected: 11000, cd: 6000, debtPaymentReference: "DF-000000002" };
  assert.deepEqual(readAccountReceipt(snapshot), snapshot);
});
test("fully unpaid new sale is a statement, not a payment", () => {
  assert.equal(readAccountReceipt({ bd: 2000, saleTotal: 10000, paidOld: 0, paidSale: 0, collected: 0, cd: 12000, debtPaymentReference: null })?.cd, 12000);
});
test("old receipts without historical account data are preserved as legacy", () => {
  assert.equal(readAccountReceipt(null), null);
});
test("wrong or changed account arithmetic is never presented as verified", () => {
  const good = { bd: 5000, saleTotal: 12000, paidOld: 3000, paidSale: 8000, collected: 11000, cd: 6000, debtPaymentReference: null };
  assert.equal(readAccountReceipt({ ...good, cd: 0 }), null);
  assert.equal(readAccountReceipt({ ...good, paidOld: 9000 }), null);
  assert.equal(readAccountReceipt({ ...good, collected: 12000 }), null);
  assert.equal(readAccountReceipt({ ...good, saleTotal: -1 }), null);
  assert.equal(readAccountReceipt({ ...good, bd: "5000" }), null);
});
