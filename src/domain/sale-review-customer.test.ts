import assert from "node:assert/strict";
import { test } from "node:test";
import { saleReviewCustomerHeader, validSaleReviewCustomerId } from "./sale-review-customer.ts";

test("review identifier header is stable for cached and fresh clients", () => {
  assert.equal(saleReviewCustomerHeader, "x-depotflow-review-customer-id");
  assert.equal(validSaleReviewCustomerId("12345678-1234-4234-8234-123456789abc"), true);
  assert.equal(validSaleReviewCustomerId("12345678-1234-4234-8234-123456789ABC"), true);
});

test("malformed or absent IDs cannot enter the privileged review lookup", () => {
  for (const id of [
    null, undefined, "", "customer-1", "walk-in", 12, {},
    "12345678-1234-4234-8234-123456789ab", "12345678-1234-4234-8234-123456789abX",
    " 12345678-1234-4234-8234-123456789abc", "12345678-1234-4234-8234-123456789abc\n",
  ]) assert.equal(validSaleReviewCustomerId(id), false, `Rejected: ${JSON.stringify(id)}`);
});
