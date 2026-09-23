import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptySaleDraft,
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
  crate_type: { name: "Exact crate", is_legacy: false, pocket_count: 12 },
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
  customers: [{ id: "c", name: "Customer", phone: "08000000000" }],
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
test("resume/review totals use current prices and flag price, stock, product and customer changes", () => {
  assert.equal(revalidateSaleDraft(draft, catalog).total, 12000);
  const check = revalidateSaleDraft(draft, {
    ...catalog,
    products: [{ ...product, full_crate_price: 13000 }],
  });
  assert.equal(check.total, 13000);
  assert.match(check.warnings.join(), /Price changed/);
  const shortage = revalidateSaleDraft(draft, {
    ...catalog,
    products: [{ ...product, available: 5 }],
  });
  assert.equal(shortage.total, undefined);
  assert.match(shortage.warnings.join(), /all that is in stock/);
  const absent = revalidateSaleDraft(draft, { products: [], customers: [] });
  assert.equal(absent.total, undefined);
  assert.match(absent.warnings.join(), /no longer available/);
  const unpriced = revalidateSaleDraft(draft, {
    ...catalog,
    products: [{ ...product, full_crate_price: null }],
  });
  assert.equal(unpriced.total, undefined);
  assert.match(unpriced.warnings.join(), /price is not set/);
});
test("quantity price choices are disabled only when a required explicit price is absent", () => {
  for (const [field, q] of [
    ["full_crate_price", { crates: 1, fraction: 0, bottles: 0 }],
    ["half_crate_price", { crates: 0, fraction: 2, bottles: 0 }],
    ["quarter_crate_price", { crates: 0, fraction: 1, bottles: 0 }],
    ["bottle_price", { crates: 0, fraction: 0, bottles: 1 }],
  ] as const) {
    assert.equal(quantityPriceSet({ ...product, [field]: null }, q), false);
    assert.equal(quantityPriceSet({ ...product, [field]: 0 }, q), true);
  }
  assert.equal(
    quantityPriceSet(
      { ...product, half_crate_price: null },
      { crates: 0, fraction: 3, bottles: 0 },
    ),
    false,
  );
  assert.equal(
    quantityPriceSet(
      { ...product, quarter_crate_price: null },
      { crates: 0, fraction: 3, bottles: 0 },
    ),
    false,
  );
  assert.equal(
    quantityPriceSet(
      { ...product, bottle_price: null },
      { crates: 1, fraction: 0, bottles: 0 },
    ),
    true,
  );
});
