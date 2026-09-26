import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  newestPayments,
  paymentHistoryState,
  validatePaymentAmount,
  type PaymentSummary,
} from "./payments.ts";

function payment(
  id: string,
  businessDate: string,
  customerId = "customer-a",
): PaymentSummary {
  return {
    id,
    customerId,
    businessDate,
    createdAt: `2026-09-23T10:00:0${id}.000Z`,
    amount: 5000,
    owedAfter: 1000,
  };
}

test("payments are ordered newest business date first", () => {
  assert.deepEqual(
    newestPayments([
      payment("1", "2026-09-20"),
      payment("2", "2026-09-24"),
      payment("3", "2026-09-23"),
    ]).map((entry) => entry.id),
    ["2", "3", "1"],
  );
});

test("same-day payments break ties by created_at then id, newest first", () => {
  assert.deepEqual(
    newestPayments([
      { ...payment("1", "2026-09-20"), createdAt: "2026-09-20T10:00:00.000Z" },
      { ...payment("2", "2026-09-20"), createdAt: "2026-09-20T12:00:00.000Z" },
    ]).map((entry) => entry.id),
    ["2", "1"],
  );
});

test("payment history exposes its useful empty state", () => {
  assert.deepEqual(paymentHistoryState([]), { empty: true, payments: [] });
  assert.equal(
    paymentHistoryState([payment("1", "2026-09-23")]).empty,
    false,
  );
});

test("valid whole payment amounts are accepted", () => {
  assert.equal(validatePaymentAmount("1"), 1);
  assert.equal(validatePaymentAmount(" 16500 "), 16500);
  assert.equal(validatePaymentAmount("2147483647"), 2147483647);
});

test("zero, negative, decimal, and non-numeric amounts are rejected", () => {
  for (const bad of [
    "0",
    "-1",
    "12.5",
    "1e3",
    "",
    "   ",
    "abc",
    "1,000",
    "₦100",
    "2147483648",
    "-0",
  ]) {
    assert.throws(() => validatePaymentAmount(bad));
  }
});

test("payment history query is scoped to the requested customer and does not touch sale totals", () => {
  const source = readFileSync(
    new URL("../lib/payments/data.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /\.eq\("customer_id", customerId\)/);
  assert.doesNotMatch(source, /from\("sales"\)/);
  assert.doesNotMatch(source, /update\(/);
});

test("payment history reuses the caller's already-authorized owner session", () => {
  const data = readFileSync(
    new URL("../lib/payments/data.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    data,
    /supabase: Awaited<ReturnType<typeof requireOwner>>/,
  );
});
