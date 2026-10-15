import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptySaleDraft,
  readSaleDraft,
  putSaleLine,
  quantityPriceSet,
  revalidateSaleDraft,
  type SaleProduct,
} from "./sale-builder.ts";
import {
  emptySaleDrafts,
  updateActiveSale,
  parkActiveSale,
  resumeSale,
  cancelSale,
  completeSale,
  readSaleDrafts,
  isSaleRequestId,
  replaceActiveSaleId,
  setActiveSaleSaveUncertain,
  selectSaleCustomer,
} from "./sale-drafts.ts";
const product: SaleProduct = {
  id: "p",
  name: "Drink",
  size: null,
  image_url: null,
  bottles_per_crate: 12,
  full_crate_price: 12000,
  half_crate_price: 6500,
  quarter_crate_price: 3500,
  bottle_price: 1500,
  available: 100,
  crate_type_id: "crate",
  crate_type: { name: "Exact crate", is_legacy: false, pocket_count: 12, empty_family: "Test" },
  bottles_returnable: true,
  bottle_type: "glass",
};
const line = {
  productId: "p",
  quantity: { crates: 1, fraction: 0 as const, bottles: 0 },
};
test("saving clears only the matching active sale and leaves paused drafts", () => {
  const active = {
    id: "active",
    pausedAt: null,
    draft: { ...emptySaleDraft, customerId: "a" },
  };
  const paused = {
    id: "paused",
    pausedAt: new Date().toISOString(),
    draft: { ...emptySaleDraft, customerId: "b" },
  };
  const state = { ...emptySaleDrafts, active, paused: [paused] };
  assert.deepEqual(completeSale(state, "active"), { ...state, active: null });
  assert.throws(() => completeSale(state, "paused"), /active sale changed/);
});
const draft = {
  ...emptySaleDraft,
  customerId: "c",
  step: "quantity" as const,
  crates: "3",
  bottles: "2",
  editingId: "p",
  lines: putSaleLine([], line, product),
};
const catalog = {
  products: [product],
  customers: [
    {
      id: "c",
      name: "Customer",
      phone: "08000000000",
      empties_deposit_required: false,
    },
  ],
  crateTypes: [
    { id: "crate", name: "Exact crate", is_legacy: false, pocket_count: 12 },
  ],
  swapRules: [],
};
const now = "2026-09-15T12:00:00Z";
test("park preserves stable identity and quantities; starting another sale creates an independent active draft", () => {
  const first = updateActiveSale(emptySaleDrafts, null, draft, "a");
  const parked = parkActiveSale(first, "a", now);
  assert.equal(parked.active, null);
  assert.equal(parked.paused[0].id, "a");
  assert.deepEqual(parked.paused[0].draft, draft);
  assert.equal(parked.paused[0].pausedAt, now);
  const second = updateActiveSale(parked, null, { customerId: "other" }, "b");
  assert.equal(second.active?.id, "b");
  assert.equal(second.active?.draft.lines.length, 0);
  assert.deepEqual(second.paused[0].draft, draft);
  const resumed = resumeSale(second, "a", now);
  assert.equal(resumed.active?.id, "a");
  assert.deepEqual(resumed.active?.draft, draft);
  assert.equal(resumed.paused.length, 1);
  assert.equal(resumed.paused[0].id, "b");
  assert.throws(
    () => updateActiveSale(resumed, "b", { lines: [] }, "ignored"),
    /active sale changed/,
  );
});
test("legacy draft ID can be replaced once with a stable save request ID", () => {
  const state = updateActiveSale(emptySaleDrafts, null, draft, "legacy-sale");
  const requestId = "40000000-0000-4000-8000-000000000999";
  assert.equal(isSaleRequestId("legacy-sale"), false);
  assert.equal(isSaleRequestId(requestId), true);

  const migrated = replaceActiveSaleId(state, "legacy-sale", requestId);
  assert.equal(migrated.active?.id, requestId);
  assert.deepEqual(migrated.active?.draft, draft);
  assert.throws(
    () => replaceActiveSaleId(migrated, "legacy-sale", crypto.randomUUID()),
    /active sale changed/,
  );
});

test("uncertain save state survives persistence and keeps the same request ID", () => {
  const requestId = "40000000-0000-4000-8000-000000000998";
  let state = updateActiveSale(emptySaleDrafts, null, draft, requestId);
  state = setActiveSaleSaveUncertain(state, requestId, true);
  const restored = readSaleDrafts(JSON.stringify(state));

  assert.equal(restored.active?.id, requestId);
  assert.equal(restored.active?.saveUncertain, true);
  assert.deepEqual(restored.active?.draft, draft);

  const cleared = setActiveSaleSaveUncertain(restored, requestId, false);
  assert.equal(cleared.active?.saveUncertain, false);
});

test("pre-upgrade active and parked sale drafts receive a zero old-debt payment", () => {
  const savedDraft = { ...draft };
  const legacyDraft = { ...savedDraft } as Partial<typeof savedDraft>;
  delete legacyDraft.oldDebtPaid;
  const legacy = {
    version: 2,
    active: {
      id: "40000000-0000-4000-8000-000000008810",
      pausedAt: null,
      saveUncertain: true,
      draft: legacyDraft,
    },
    paused: [{
      id: "40000000-0000-4000-8000-000000008811",
      pausedAt: now,
      draft: legacyDraft,
    }],
  };
  const restored = readSaleDrafts(JSON.stringify(legacy));
  assert.equal(restored.active?.saveUncertain, true);
  assert.equal(restored.active?.draft.oldDebtPaid, "0");
  assert.equal(restored.paused[0].draft.oldDebtPaid, "0");
  assert.equal(restored.active?.draft.customerId, savedDraft.customerId);
  assert.deepEqual(restored.active?.draft.lines, savedDraft.lines);
});

test("editing a stored draft preserves its uncertain-save marker", () => {
  const requestId = "40000000-0000-4000-8000-000000000997";
  let state = updateActiveSale(emptySaleDrafts, null, draft, requestId);
  state = setActiveSaleSaveUncertain(state, requestId, true);
  state = updateActiveSale(state, requestId, { paid: "5000" }, requestId);
  assert.equal(state.active?.saveUncertain, true);
});

test("cancel removes only the named unfinished draft", () => {
  let state = updateActiveSale(emptySaleDrafts, null, draft, "a");
  state = parkActiveSale(state, "a", now);
  state = updateActiveSale(state, null, { customerId: "other" }, "b");
  const cancelled = cancelSale(state, "a");
  assert.equal(cancelled.paused.length, 0);
  assert.deepEqual(cancelled.active, state.active);
  const activeCancelled = cancelSale(state, "b");
  assert.equal(activeCancelled.active, null);
  assert.deepEqual(activeCancelled.paused, state.paused);
  assert.deepEqual(cancelSale(state, "missing"), state);
});
test("persisted drafts restore quantities and customer IDs without storing customer searches or totals", () => {
  const state = updateActiveSale(
    emptySaleDrafts,
    null,
    { ...draft, customerQuery: "08012345678" },
    "a",
  );
  assert.equal(state.active?.draft.customerQuery, "");
  assert.equal(JSON.stringify(state).includes("08012345678"), false);
  const restored = readSaleDrafts(
    JSON.stringify(parkActiveSale(state, "a", now)),
  );
  assert.deepEqual(restored.paused[0].draft.lines, draft.lines);
  assert.equal(restored.paused[0].draft.customerId, "c");
  assert.equal(readSaleDrafts("invalid"), emptySaleDrafts);
  assert.equal(
    readSaleDrafts(
      JSON.stringify({
        ...restored,
        paused: [...restored.paused, ...restored.paused],
      }),
    ),
    emptySaleDrafts,
  );
});
test("sale facts survive local persistence while the network is unavailable", () => {
  const offlineDraft = {
    ...draft,
    step: "payment" as const,
    paid: "5000",
    businessDate: "2026-09-27",
    emptiesV2: {
      mode: "actual" as const,
      cratesTaken: { p: "1" },
      returnedCrates: { crate: "1" },
      returnedBottles: { glass: "10" },
    },
  };
  const state = updateActiveSale(
    emptySaleDrafts,
    null,
    offlineDraft,
    "offline-sale",
  );
  const restored = readSaleDrafts(JSON.stringify(state));
  assert.equal(restored.active?.id, "offline-sale");
  assert.equal(restored.active?.draft.step, "payment");
  assert.equal(restored.active?.draft.paid, "5000");
  assert.equal(restored.active?.draft.businessDate, "2026-09-27");
  assert.deepEqual(restored.active?.draft.lines, offlineDraft.lines);
  assert.deepEqual(restored.active?.draft.emptiesV2, offlineDraft.emptiesV2);
});

test("resume/review totals use current prices and flag price, stock, product and customer changes", () => {
  assert.equal(revalidateSaleDraft(draft, catalog).total, 12000);
  const check = revalidateSaleDraft(draft, {
    ...catalog,
    products: [{ ...product, full_crate_price: 13000 }],
  });
  assert.equal(check.total, 13000);
  assert.match(
    check.warnings.join(),
    /Price for this quantity changed from ₦12,000 to ₦13,000\./,
  );
  const shortage = revalidateSaleDraft(draft, {
    ...catalog,
    products: [{ ...product, available: 5 }],
  });
  assert.equal(shortage.total, undefined);
  assert.match(
    shortage.warnings.join(),
    /Only 5 bottles available now\. Change the quantity\./,
  );
  const absent = revalidateSaleDraft(draft, {
    products: [],
    customers: [],
    crateTypes: [],
    swapRules: [],
  });
  assert.equal(absent.total, undefined);
  assert.match(absent.warnings.join(), /no longer available/);
  const unpriced = revalidateSaleDraft(draft, {
    ...catalog,
    products: [{ ...product, full_crate_price: null }],
  });
  assert.equal(unpriced.total, undefined);
  assert.match(unpriced.warnings.join(), /price is not set/);
});
test("inactive customer warning is plain and changing customer keeps the sale work", () => {
  const unavailable = revalidateSaleDraft(draft, {
    ...catalog,
    customers: [],
  });
  assert.ok(
    unavailable.warnings.includes(
      "This customer is no longer active. Choose another customer.",
    ),
  );

  const state = updateActiveSale(
    emptySaleDrafts,
    null,
    draft,
    "sale-1",
  );
  const moved = updateActiveSale(
    state,
    "sale-1",
    { step: "customer" },
    "sale-1",
  );
  assert.equal(moved.active?.draft.step, "customer");
  assert.deepEqual(moved.active?.draft.lines, draft.lines);
  assert.equal(moved.active?.draft.paid, draft.paid);
});

test("quantity price choices allow derived partials but require independent bottle prices", () => {
  for (const [field, q] of [
    ["full_crate_price", { crates: 1, fraction: 0, bottles: 0 }],
    ["half_crate_price", { crates: 0, fraction: 2, bottles: 0 }],
    ["quarter_crate_price", { crates: 0, fraction: 1, bottles: 0 }],
    ["bottle_price", { crates: 0, fraction: 0, bottles: 1 }],
  ] as const) {
    assert.equal(
      quantityPriceSet({ ...product, [field]: null }, q),
      field === "half_crate_price" || field === "quarter_crate_price",
    );
    assert.equal(quantityPriceSet({ ...product, [field]: 0 }, q), true);
  }
  assert.equal(
    quantityPriceSet(
      { ...product, half_crate_price: null },
      { crates: 0, fraction: 3, bottles: 0 },
    ),
    true,
  );
  assert.equal(
    quantityPriceSet(
      { ...product, quarter_crate_price: null },
      { crates: 0, fraction: 3, bottles: 0 },
    ),
    true,
  );
  assert.equal(
    quantityPriceSet(
      { ...product, bottle_price: null },
      { crates: 1, fraction: 0, bottles: 0 },
    ),
    true,
  );
});

test("selecting a newly created customer clears previous customer's debt allocation", () => {
  const state = {
    ...emptySaleDrafts,
    active: {
      id: "original",
      pausedAt: null,
      draft: { ...emptySaleDraft, customerId: "old", oldDebtPaid: "2500" },
    },
  };
  const next = selectSaleCustomer(state, "original", "new", "new-draft");
  assert.equal(next.active?.draft.customerId, "new");
  assert.equal(next.active?.draft.oldDebtPaid, "0");
});
test("old sale drafts without previous debt payment default to zero", () => {
  const legacy = { ...emptySaleDraft };
  delete (legacy as Partial<typeof legacy>).oldDebtPaid;
  const serialized = JSON.stringify(legacy);
  assert.equal(readSaleDraft(serialized).oldDebtPaid, "0");
});

test("adding a new customer during checkout cannot carry the earlier customer's payment or empties data", () => {
  const oldDraft = {
    ...emptySaleDraft,
    customerId: "old",
    paid: "1500",
    oldDebtPaid: "500",
    paymentMethod: "transfer",
    lines: [line],
    emptiesV2: {
      ...emptySaleDraft.emptiesV2, mode: "actual" as const,
      decisions: [{ productId: "p", kind: "bottle" as const, returnedType: "other", quantity: "1", decision: "hold" as const }],
      confirmedAllReturned: "old-confirmation",
      returnedCrates: { crate: "1" },
      returnedBottles: { glass: "12" },
      cratesTaken: { p: "1" },
    },
  };
  const state = { ...emptySaleDrafts, active: { id: "active", pausedAt: null, draft: oldDraft } };
  const next = selectSaleCustomer(state, "active", "new", "unused");
  assert.equal(next.active?.draft.customerId, "new");
  assert.deepEqual(next.active?.draft.lines, oldDraft.lines);
  assert.equal(next.active?.draft.paid, "0");
  assert.equal(next.active?.draft.oldDebtPaid, "0");
  assert.equal(next.active?.draft.paymentMethod, "");
  assert.equal(next.active?.draft.emptiesV2.confirmedAllReturned, null);
  assert.deepEqual(next.active?.draft.emptiesV2.returnedBottles, {});
  assert.deepEqual(next.active?.draft.emptiesV2.decisions, []);
});
