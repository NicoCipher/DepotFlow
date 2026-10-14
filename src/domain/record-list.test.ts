import assert from "node:assert/strict";
import { test } from "node:test";
import { recordListView } from "./record-list.ts";
import type { CustomerRecord } from "./records.ts";

const base: CustomerRecord = {
  id: "20000000-0000-4000-8000-000000000961",
  day: "2026-10-14", created_at: "2026-10-14T15:56:00Z",
  kind: "sale", customer_id: "10000000-0000-4000-8000-000000000961",
  customer_name: "Oba", business_name: "Vulganizer",
  receipt_number: "DF-000000020", method: "cash",
  sale_total: 1000, received: 1000, remaining: 0,
  old_debt_paid: 1000, checkout_received: 2000, checkout_balance: 0,
  linked_sale_id: null, linked_payment_voided: false,
  crates: 0, bottles: 0, held_crates: 0, held_bottles: 0,
  status: "paid", detail: "/receipts/sale/id",
};

test("combined visit shows the collected amount and a short settled state", () => {
  const x = recordListView(base);
  assert.equal(x.label,"Sale + debt");
  assert.equal(x.money,2000);
  assert.equal(x.moneyLabel,"Collected");
  assert.equal(x.status,"All settled");
  assert.equal(x.tone,"success");
});
test("combined visit with unpaid balance shows outstanding state without saying zero", () => {
  const x=recordListView({...base,received:500,remaining:500,checkout_received:1500,checkout_balance:500,status:"partial"});
  assert.equal(x.money,1500);
  assert.equal(x.status,"Balance owing");
  assert.equal(x.tone,"warning");
});
test("unknown checkout balance is not invented as zero", () => {
  const x=recordListView({...base,checkout_balance:null});
  assert.equal(x.status,"Checkout saved");
});
test("voided linked debt payment is not displayed as valid cash received", () => {
  const x=recordListView({...base,linked_payment_voided:true});
  assert.equal(x.combined,false);
  assert.equal(x.money,1000);
  assert.equal(x.status,"Payment voided");
  assert.equal(x.tone,"danger");
});
test("voided sale never shows combined collected value", () => {
  const x=recordListView({...base,status:"voided"});
  assert.equal(x.combined,false);
  assert.equal(x.status,"Voided");
  assert.equal(x.money,1000);
});
test("standalone sale, unpaid and payment statuses are distinct", () => {
  const unpaid=recordListView({...base,old_debt_paid:0,received:0,remaining:1000,status:"unpaid"});
  assert.equal(unpaid.status,"Unpaid");
  assert.equal(unpaid.money,1000);
  const payment=recordListView({...base,kind:"payment",linked_sale_id:base.id,status:"received",received:1000});
  assert.equal(payment.label,"Debt payment");
  assert.equal(payment.money,1000);
  assert.equal(payment.paymentDuringSale,true);
});
test("non-cash movements never pretend to be money", () => {
  const held=recordListView({...base,kind:"empties",status:"recorded",old_debt_paid:0,received:0,
    crates:0,bottles:0,held_crates:2,held_bottles:4});
  assert.equal(held.heldOnly,true);
  assert.equal(held.money,null);
  assert.equal(held.label,"Held empties collected");
  const normal=recordListView({...base,kind:"empties",status:"recorded",crates:2,bottles:5});
  assert.equal(normal.money,null);
  const opening=recordListView({...base,kind:"opening",status:"recorded",remaining:900});
  assert.equal(opening.money,900);
});
