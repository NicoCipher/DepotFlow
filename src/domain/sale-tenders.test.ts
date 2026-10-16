import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateSplitTender, parseTenderNaira, validateTenderLegs } from "./sale-tenders.ts";

test("cash and transfer split a fully paid sale without prior debt", () => {
  const legs = allocateSplitTender(1700, 0, { cash: "700", transfer: "1000" });
  assert.deepEqual(legs, [
    { method: "cash", saleAmount: 700, oldDebtAmount: 0, amount: 700 },
    { method: "transfer", saleAmount: 1000, oldDebtAmount: 0, amount: 1000 },
  ]);
  assert.doesNotThrow(() => validateTenderLegs(legs, 1700, 0));
});
test("partial sale with combined old-debt collection keeps ledgers separate", () => {
  const legs = allocateSplitTender(8000, 3000, { cash: "5000", transfer: "6000" });
  assert.deepEqual(legs, [
    { method: "cash", saleAmount: 5000, oldDebtAmount: 0, amount: 5000 },
    { method: "transfer", saleAmount: 3000, oldDebtAmount: 3000, amount: 6000 },
  ]);
  validateTenderLegs(legs, 8000, 3000);
});
test("old-debt-only collection does not claim payment for the new sale", () => {
  const legs = allocateSplitTender(0, 3000, { cash: "1000", transfer: "2000" });
  assert.equal(legs[0].saleAmount, 0);
  assert.equal(legs[1].oldDebtAmount, 2000);
  validateTenderLegs(legs, 0, 3000);
});
test("explicit allocation permits cash toward debt and transfer toward sale", () => {
  const legs = allocateSplitTender(1500, 500, {
    cash: "500", transfer: "1500", cashToSale: "0",
  });
  assert.deepEqual(legs, [
    { method: "cash", saleAmount: 0, oldDebtAmount: 500, amount: 500 },
    { method: "transfer", saleAmount: 1500, oldDebtAmount: 0, amount: 1500 },
  ]);
  validateTenderLegs(legs, 1500, 500);
});
test("no payment, same method, and incorrect totals cannot masquerade as split tender", () => {
  for (const [cash, transfer] of [["0", "0"], ["1700", "0"], ["0", "1700"]]) {
    assert.throws(() => allocateSplitTender(1700, 0, { cash, transfer }), /one payment method/i);
  }
  assert.throws(() => allocateSplitTender(1700, 0, { cash: "700", transfer: "900" }), /must equal/i);
  assert.throws(() => allocateSplitTender(1700, 0, { cash: "700", transfer: "1100" }), /must equal/i);
});
test("cannot misallocate cash to debt beyond amount actually owed", () => {
  assert.throws(() => allocateSplitTender(1500, 500, { cash: "500", transfer: "1500", cashToSale: "501" }), /allocate/i);
  assert.throws(() => allocateSplitTender(1500, 500, { cash: "1000", transfer: "1000", cashToSale: "100" }), /allocate/i);
});
test("amounts must be exact nonnegative whole naira and capped", () => {
  for (const raw of ["", "-1", "0.50", "1,700", "1e3", "NaN", "2147483648", " 200", "200 "]) {
    assert.throws(() => parseTenderNaira(raw, "cash"));
  }
  assert.equal(parseTenderNaira("0", "cash"), 0);
  assert.throws(() => allocateSplitTender(2147483647, 1, { cash: "1", transfer: "1" }), /too large/i);
});
test("ledger rejects duplicate or fabricated methods and allocation mismatches", () => {
  const c = { method: "cash" as const, saleAmount: 500, oldDebtAmount: 0, amount: 500 };
  const t = { method: "transfer" as const, saleAmount: 500, oldDebtAmount: 0, amount: 500 };
  assert.throws(() => validateTenderLegs([c, c], 1000, 0), /only once/i);
  assert.throws(() => validateTenderLegs([{ ...c, method: "pos" as const }, c, t], 1500, 0), /one or two/i);
  assert.throws(() => validateTenderLegs([c, { ...t, amount: 1000 }], 1000, 0), /match/i);
  assert.throws(() => validateTenderLegs([c, t], 900, 100), /do not match/i);
  assert.throws(() => validateTenderLegs([{ ...c, amount: 0 }], 500, 0), /match/i);
});
