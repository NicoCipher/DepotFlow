import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentConfirmationKey, emptyReturnConfirmationKey } from "./action-confirmations.ts";

test("payment confirmation expires on changes to amount, method, date, customer or debt", () => {
  const base = {
    request: "payment-request", customer: "customer-a", amount: "5000",
    method: "cash", businessDate: "2026-10-15", owed: 9000,
  };
  const key = paymentConfirmationKey(base);
  assert.equal(key, paymentConfirmationKey({ ...base }));
  assert.notEqual(key, paymentConfirmationKey({ ...base, amount: "6000" }));
  assert.notEqual(key, paymentConfirmationKey({ ...base, method: "transfer" }));
  assert.notEqual(key, paymentConfirmationKey({ ...base, businessDate: "2026-10-16" }));
  assert.notEqual(key, paymentConfirmationKey({ ...base, customer: "customer-b" }));
  assert.notEqual(key, paymentConfirmationKey({ ...base, owed: 10000 }));
  assert.notEqual(key, paymentConfirmationKey({ ...base, request: "another-request" }));
});

test("empty returns confirmation covers exact types, amounts and held releases", () => {
  const base = {
    request: "return-request", customer: "customer-a",
    counts: { "crate:goldberg": "2", "bottle:goldberg": "12" },
    released: ["hold-a"],
  };
  const key = emptyReturnConfirmationKey(base);
  assert.equal(key, emptyReturnConfirmationKey({ ...base,
    counts: { "bottle:goldberg": "12", "crate:goldberg": "2" },
    released: ["hold-a"],
  }));
  assert.notEqual(key, emptyReturnConfirmationKey({ ...base, counts: { ...base.counts, "crate:goldberg": "1" } }));
  assert.notEqual(key, emptyReturnConfirmationKey({ ...base, counts: { ...base.counts, "bottle:other": "12" } }));
  assert.notEqual(key, emptyReturnConfirmationKey({ ...base, released: [] }));
  assert.notEqual(key, emptyReturnConfirmationKey({ ...base, customer: "customer-b" }));
  assert.notEqual(key, emptyReturnConfirmationKey({ ...base, request: "new-request" }));
  assert.equal(emptyReturnConfirmationKey({ ...base, released: ["b", "a"] }),
    emptyReturnConfirmationKey({ ...base, released: ["a", "b"] }));
});
