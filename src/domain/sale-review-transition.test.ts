import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySaleDraft } from "./sale-builder.ts";
import { readSaleDrafts, type SaleDrafts } from "./sale-drafts.ts";
import { transitionSaleToReview } from "./sale-review-transition.ts";

const draft = {
  ...emptySaleDraft,
  customerId: "11111111-1111-4111-8111-111111111111",
  step: "payment" as const,
  paid: "1700",
  oldDebtPaid: "0",
  paymentMethod: "cash",
  lines: [{
    productId: "22222222-2222-4222-8222-222222222222",
    quantity: { crates: 0, fraction: 0 as const, bottles: 1 },
  }],
  emptiesV2: { ...emptySaleDraft.emptiesV2, confirmedAllReturned: "confirmed" },
};
const state: SaleDrafts = {
  version: 2,
  active: { id: "33333333-3333-4333-8333-333333333333", draft, pausedAt: null },
  paused: [],
};
const reviewed = {
  lines: draft.lines.map((line) => ({
    ...line,
    reviewExpected: {
      full: 10000, half: null, quarter: null, bottle: 1700, size: 24,
      crate: "44444444-4444-4444-8444-444444444444",
      returnable: false, bottleType: null, stock: 48,
    },
  })),
  businessDate: "2026-10-17",
};

test("P0: ₦1700 Cash, ₦0 previous debt advances Payment to durable Review", () => {
  const next = transitionSaleToReview(state, state.active!.id, draft, reviewed,
    "55555555-5555-4555-8555-555555555555");
  assert.equal(next.active?.draft.step, "review");
  assert.equal(next.active?.draft.paid, "1700");
  assert.equal(next.active?.draft.paymentMethod, "cash");
  assert.equal(next.active?.draft.oldDebtPaid, "0");
  assert.deepEqual(next.active?.draft.lines, reviewed.lines);
  assert.equal(readSaleDrafts(JSON.stringify(next)).active?.draft.step, "review");
  assert.equal(state.active?.draft.step, "payment", "source draft remains intact");
});

test("Review never attaches a checked price to money edited in another tab", () => {
  const changed: SaleDrafts = {
    ...state, active: { ...state.active!, draft: { ...draft, paid: "1600" } },
  };
  assert.throws(() =>
    transitionSaleToReview(changed, state.active!.id, draft, reviewed,
      "55555555-5555-4555-8555-555555555555"),
    /sale changed while Review/i);
  assert.equal(changed.active?.draft.step, "payment");
});

test("Review refuses a changed sale identity, step or empty-return decision", () => {
  const changedEmpties: SaleDrafts = {
    ...state, active: {
      ...state.active!, draft: {
        ...draft, emptiesV2: { ...draft.emptiesV2, returnedBottles: { wrong: "1" } },
      },
    },
  };
  const otherStep: SaleDrafts = {
    ...state, active: { ...state.active!, draft: { ...draft, step: "empties" } },
  };
  for (const s of [changedEmpties, otherStep]) {
    assert.throws(() =>
      transitionSaleToReview(s, state.active!.id, draft, reviewed,
        "55555555-5555-4555-8555-555555555555"), /sale changed/i);
  }
  assert.throws(() =>
    transitionSaleToReview(state, "66666666-6666-4666-8666-666666666666",
      draft, reviewed, "55555555-5555-4555-8555-555555555555"),
    /sale changed/i);
});


test("multi-method Review is fenced against changes to each received or old-debt allocation", () => {
  const multi = { ...draft, paymentMode: "multi" as const, paymentMethod: "mixed",
    multiMethods: ["cash","pos"] as ("cash" | "pos")[],
    multiReceived: { cash: "700", transfer: "0", pos: "1000" },
    multiOldDebt: { cash: "0", transfer: "0", pos: "0" },
  };
  const baseline: SaleDrafts = { ...state, active: { ...state.active!, draft: multi } };
  const id = state.active!.id;
  const ok = transitionSaleToReview(baseline, id, multi, reviewed, crypto.randomUUID());
  assert.equal(ok.active?.draft.step,"review");
  assert.deepEqual(ok.active?.draft.multiMethods, ["cash","pos"]);
  const changes = [
    { multiMethods: ["cash","transfer"] as ("cash" | "transfer")[] },
    { multiReceived: { ...multi.multiReceived, cash: "701" } },
    { multiOldDebt: { ...multi.multiOldDebt, pos: "1" } },
  ];
  for (const patch of changes) {
    const changed: SaleDrafts = {
      ...baseline,
      active: { ...baseline.active!, draft: { ...multi, ...patch } },
    };
    assert.throws(() => transitionSaleToReview(changed,id,multi,reviewed,crypto.randomUUID()), /changed while Review/);
    assert.equal(changed.active?.draft.step,"payment");
  }
});
