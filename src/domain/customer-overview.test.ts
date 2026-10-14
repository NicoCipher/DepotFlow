import assert from "node:assert/strict";
import { test } from "node:test";
import { customerHasOutstanding, sumOwed } from "./customer-overview.ts";

test("sum owed counts each exact empty obligation separately", () => {
  assert.equal(sumOwed([{ quantity: 2 }, { quantity: 1 }]), 3);
  assert.equal(sumOwed([{ quantity: 3 }, { quantity: 6 }]), 9);
  assert.equal(sumOwed([]), 0);
});

test("money, owed empties and held mismatches independently require attention", () => {
  assert.equal(customerHasOutstanding(0, 0, 0), false);
  assert.equal(customerHasOutstanding(5000, 0, 0), true);
  assert.equal(customerHasOutstanding(0, 1, 0), true);
  assert.equal(customerHasOutstanding(0, 0, 1), true);
  assert.equal(customerHasOutstanding(0, 0, 0, 1), true);
  assert.equal(customerHasOutstanding(0, 0, 0, 0), false);
  assert.equal(sumOwed([]), 0);
});
