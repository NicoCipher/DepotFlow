import assert from "node:assert/strict";
import { test } from "node:test";
import { activityEventLabel } from "./activity.ts";

test("labels known activity types correctly", () => {
  assert.equal(activityEventLabel("sale", "Sale · Customer"), "Sale");
  assert.equal(activityEventLabel("payment", "Payment · Customer"), "Payment");
  assert.equal(activityEventLabel("opening", "Opening balances · Customer"), "Opening balance");
  assert.equal(activityEventLabel("stock", "Received stock · Lager"), "Stock received");
  assert.equal(activityEventLabel("stock", "Stock count · Lager"), "Stock count");
  assert.equal(activityEventLabel("empties", "Empty crate count · NB"), "Empty crate count");
  assert.equal(activityEventLabel("empties", "Empties returned · Customer"), "Empties returned");
});

test("null, undefined and unexpected descriptions never crash the activity feed", () => {
  for (const missing of [null, undefined, ""]) {
    assert.equal(activityEventLabel("stock", missing), "Stock activity");
    assert.equal(activityEventLabel("empties", missing), "Empties activity");
  }
  assert.equal(activityEventLabel("other", null), "Activity");
});
