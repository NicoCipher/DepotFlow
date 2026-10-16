import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSaleReviewProgressMessage,
  saleReviewCheckingMessage,
  saleReviewOpeningMessage,
} from "./sale-review-feedback.ts";

test("review progress is neutral status rather than a red error alert", () => {
  assert.equal(isSaleReviewProgressMessage(saleReviewCheckingMessage), true);
  assert.equal(isSaleReviewProgressMessage(saleReviewOpeningMessage), true);
});
test("failed request, stale draft and expired session remain real errors", () => {
  for (const message of [
    "Could not check this sale. Check your connection and tap Review again.",
    "Could not open Review. The active sale may have changed in another tab.",
    "Sign in again to continue.",
    "Choose a customer first.",
    "",
  ]) assert.equal(isSaleReviewProgressMessage(message), false, message);
});
