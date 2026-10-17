import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateMultiTender, emptyMultiAmounts, multiPaymentFromReceived, sanitizedMultiPayment,
} from "./multi-tenders.ts";

const blank = emptyMultiAmounts;
test("Cash + POS records exactly two actual methods", () => {
  const legs = allocateMultiTender(1700, 0, {
    methods: ["pos", "cash"],
    received: { ...blank(), cash: "700", pos: "1000" },
    towardOldDebt: blank(),
  });
  assert.deepEqual(legs, [
    { method: "cash", amount: 700, saleAmount: 700, oldDebtAmount: 0 },
    { method: "pos", amount: 1000, saleAmount: 1000, oldDebtAmount: 0 },
  ]);
});
test("Transfer + POS is not mistaken for Cash + Transfer", () => {
  const legs = allocateMultiTender(1700, 0, {
    methods: ["pos", "transfer"],
    received: { ...blank(), transfer: "1000", pos: "700" },
    towardOldDebt: blank(),
  });
  assert.deepEqual(legs.map(l => l.method), ["transfer", "pos"]);
});
test("Cash + Transfer + POS accepts partial payment without reducing prior debt", () => {
  const input = {
    methods: ["pos", "cash", "transfer"] as const,
    received: { cash: "3000", transfer: "1000", pos: "1000" },
    towardOldDebt: blank(),
  };
  const preview = multiPaymentFromReceived({
    ...input, saleTotal: 5250, verifiedOldDebt: 2200,
  });
  assert.deepEqual(preview, {
    received: 5000, salePaid: 5000, oldDebtPaid: 0, issue: null,
  });
  assert.equal(allocateMultiTender(5000, 0, input).length, 3);
});
test("each payment method has an exact independent allocation to old debt", () => {
  const input = {
    methods: ["transfer", "pos", "cash"] as const,
    received: { cash: "700", pos: "1000", transfer: "2200" },
    towardOldDebt: { cash: "0", pos: "0", transfer: "2200" },
  };
  assert.deepEqual(multiPaymentFromReceived({ ...input,
    saleTotal: 1700, verifiedOldDebt: 2200,
  }), { received: 3900, salePaid: 1700, oldDebtPaid: 2200, issue: null });
  assert.deepEqual(allocateMultiTender(1700, 2200, input), [
    { method: "cash", amount: 700, saleAmount: 700, oldDebtAmount: 0 },
    { method: "transfer", amount: 2200, saleAmount: 0, oldDebtAmount: 2200 },
    { method: "pos", amount: 1000, saleAmount: 1000, oldDebtAmount: 0 },
  ]);
});
test("cash + transfer remains representable and ordered as before", () => {
  const input = { methods: ["transfer", "cash"] as const,
    received: { cash: "700", transfer: "1000", pos: "0" },
    towardOldDebt: blank() };
  assert.deepEqual(allocateMultiTender(1700, 0, input).map(l => l.method), ["cash", "transfer"]);
});
test("wrong counts, invalid money, duplicate and unknown methods fail closed", () => {
  const input = { methods: ["cash", "pos"] as const,
    received: { cash: "700", transfer: "0", pos: "1000" },
    towardOldDebt: blank() };
  assert.throws(() => allocateMultiTender(1700, 0,
    { ...input, methods: ["cash", "cash"] }), /different/i);
  assert.throws(() => allocateMultiTender(1700, 0,
    { ...input, methods: ["cash", "mobile_money" as "cash"] }), /different/i);
  assert.throws(() => allocateMultiTender(1700, 0,
    { ...input, received: { ...input.received, cash: "0" } }), /at least two/i);
  assert.throws(() => allocateMultiTender(1700, 0,
    { ...input, received: { ...input.received, cash: "700.50" } }), /whole naira/i);
  assert.throws(() => allocateMultiTender(1800, 0, input), /must match/i);
  assert.throws(() => allocateMultiTender(1700, 0,
    { ...input, towardOldDebt: { ...blank(), pos: "1001" } }), /cannot exceed/i);
});
test("cannot settle previous debt without a verified balance or overpay a sale", () => {
  const input = { methods: ["cash", "pos"] as const,
    received: { cash: "700", transfer: "0", pos: "2000" },
    towardOldDebt: { ...blank(), pos: "1000" } };
  assert.match(multiPaymentFromReceived({
    ...input, saleTotal: 1700, verifiedOldDebt: null,
  }).issue ?? "", /check.*previous debt/i);
  assert.match(multiPaymentFromReceived({
    ...input, saleTotal: 1700, verifiedOldDebt: 500,
  }).issue ?? "", /only/i);
  assert.equal(multiPaymentFromReceived({
    ...input, towardOldDebt: blank(), saleTotal: 1700, verifiedOldDebt: 0,
  }).salePaid, null);
});
test("unselected methods are always cleared rather than hidden in a receipt", () => {
  const sanitized = sanitizedMultiPayment({
    methods: ["cash", "pos"],
    received: { cash: "100", transfer: "900", pos: "200" },
    towardOldDebt: { cash: "0", transfer: "500", pos: "0" },
  });
  assert.equal(sanitized.received.transfer, "0");
  assert.equal(sanitized.towardOldDebt.transfer, "0");
});
