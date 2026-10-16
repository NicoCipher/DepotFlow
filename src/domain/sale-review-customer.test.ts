import assert from "node:assert/strict";
import { test } from "node:test";
import { validSaleReviewCustomerId } from "./sale-review-customer.ts";

test("valid stored customer UUIDs pass authoritative Review and old-balance validation", () => {
  assert.equal(validSaleReviewCustomerId("12345678-1234-4234-8234-123456789abc"), true);
  assert.equal(validSaleReviewCustomerId("12345678-1234-4234-8234-123456789ABC"), true);
  assert.equal(validSaleReviewCustomerId("6c37f1a5-dca5-47e1-a8c2-6dca421cce10"), true);
});

test("incomplete 8-4-4-12 UUID validator bug is detected", () => {
  const valid = "12345678-1234-4234-8234-123456789abc";
  const brokenRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert.equal(brokenRegex.test(valid), false,
    "The old 8-4-4-12 matcher is why live Review returned customer_invalid");
  assert.equal(validSaleReviewCustomerId(valid), true,
    "Review must accept real 36-character customer identifiers");
  assert.equal(validSaleReviewCustomerId("12345678-1234-4234-123456789abc"), false,
    "Incomplete identifiers must stay rejected");
});

test("malformed IDs fail closed, without accepting extra characters or injections", () => {
  for (const id of [null, undefined, "", "walk-in", 1, {},
    "12345678-1234-4234-8234-123456789ab", "12345678-1234-4234-8234-123456789abcX",
    " 12345678-1234-4234-8234-123456789abc", "12345678-1234-4234-8234-123456789abc\n",
  ]) assert.equal(validSaleReviewCustomerId(id), false, String(id));
});
