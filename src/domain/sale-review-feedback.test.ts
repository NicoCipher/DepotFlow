import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSaleReviewProgressMessage,
  saleReviewCheckingMessage,
  saleReviewOpeningMessage,
  contextualSaleReviewMessage,
  clearOwnSaleReviewProgress,
  canApplySaleBalancePreview,
  shouldDisableSaleDraftControls,
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

test("stale customer, cancelled sale or resumed draft hides old Review progress", () => {
  const started = { activeId: "sale-one:session-1", customerId: "customer-one" };
  const cases = [
    { ...started, step: "payment" },
    { activeId: "sale-two:session-1", customerId: "customer-one", step: "payment" },
    { activeId: null, customerId: null, step: "customer" },
    { activeId: "sale-one:session-2", customerId: "customer-one", step: "payment" },
    { activeId: "sale-one:session-1", customerId: "customer-two", step: "payment" },
    { ...started, step: "review" },
  ];
  assert.equal(contextualSaleReviewMessage(saleReviewCheckingMessage, started, cases[0]), saleReviewCheckingMessage);
  for (const current of cases.slice(1)) {
    assert.equal(contextualSaleReviewMessage(saleReviewCheckingMessage, started, current), "");
    assert.equal(contextualSaleReviewMessage(saleReviewOpeningMessage, started, current), "");
    assert.equal(contextualSaleReviewMessage("Could not verify balance.", started, current),
      "Could not verify balance.", "Real errors must not be silently cleared");
  }
});

test("stale responses clear only their own progress, never another request or real errors", () => {
  assert.equal(clearOwnSaleReviewProgress(saleReviewCheckingMessage, 4, 4), "");
  assert.equal(clearOwnSaleReviewProgress(saleReviewOpeningMessage, 4, 4), "");
  assert.equal(clearOwnSaleReviewProgress(saleReviewCheckingMessage, 4, 5), saleReviewCheckingMessage);
  assert.equal(clearOwnSaleReviewProgress("Network failed. Try again.", 4, 4), "Network failed. Try again.");
});


test("a delayed old-debt preview cannot overwrite the confirmed Review amount", () => {
  // The preview was initiated in generation 7. Server Review later
  // invalidates generation 7 before installing a fresh balance.
  assert.equal(canApplySaleBalancePreview(7, 7, true), true);
  assert.equal(canApplySaleBalancePreview(7, 8, true), false);
  assert.equal(canApplySaleBalancePreview(7, 7, false), false);
  // Retrying the preview after a failed Review uses a new generation.
  assert.equal(canApplySaleBalancePreview(9, 9, true), true);
});


test("Review remains tappable while an unrelated checkout transition is pending", () => {
  assert.equal(shouldDisableSaleDraftControls("payment", true, false), false,
    "old fieldset disabled all controls while the button appeared active");
  assert.equal(shouldDisableSaleDraftControls("payment", false, false), false);
  assert.equal(shouldDisableSaleDraftControls("payment", false, true), true,
    "a running Review must reject duplicate taps");
  assert.equal(shouldDisableSaleDraftControls("payment", true, true), true);
  for (const step of ["customer", "drinks", "empties", "quantity", "review"]) {
    assert.equal(shouldDisableSaleDraftControls(step, true, false), true,
      `${step} must still await a draft-changing transition`);
  }
});
