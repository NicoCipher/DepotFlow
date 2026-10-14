import assert from "node:assert/strict";
import { test } from "node:test";
import { customerHasOutstanding, owedByCustomer, sumOwed } from "./customer-overview.ts";

test("customer overview keeps crate and bottle obligations separate, and does not multiply by stock", () => {
  const crates = [{ customer_id: "a", quantity: 2 }, { customer_id: "a", quantity: 1 }, { customer_id: "b", quantity: 4 }];
  const bottles = [{ customer_id: "a", quantity: 3 }, { customer_id: "a", quantity: 6 }];
  assert.equal(owedByCustomer(crates).get("a"), 3);
  assert.equal(owedByCustomer(crates).get("b"), 4);
  assert.equal(owedByCustomer(bottles).get("a"), 9);
  assert.equal(owedByCustomer(bottles).get("b"), undefined);
  assert.equal(sumOwed([{ quantity: 3 }, { quantity: 6 }]), 9);
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
