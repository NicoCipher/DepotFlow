import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptySaleDraft,
  matchesSaleCustomer,
  priceQuantity,
  putSaleLine,
  readSaleDraft,
  removeSaleLine,
  saleQuantityLabel,
  salePriceSnapshot,
  salePriceChangeMessage,
  saleTotal,
  reviewedLine,
  reviewedTotal,
  type SaleProduct,
} from "./sale-builder.ts";
const product: SaleProduct = {
  id: "one",
  name: "Drink",
  size: null,
  image_url: null,
  bottles_per_crate: 12,
  full_crate_price: 12000,
  half_crate_price: 6500,
  quarter_crate_price: 3500,
  bottle_price: 1500,
  available: 240,
  crate_type_id: "crate",
  crate_type: { name: "Exact crate", is_legacy: false, pocket_count: 12, empty_family: "Test" },
  bottles_returnable: true,
  bottle_type: "glass",
};
const q = (crates = 0, fraction: 0 | 1 | 2 | 3 = 0, bottles = 0) => ({
  crates,
  fraction,
  bottles,
});
test("review keeps the original payable total for an idempotent retry after stock changes", () => {
  const line = reviewedLine(
    { productId: product.id, quantity: q(1, 0, 0) },
    product,
  );
  assert.equal(reviewedTotal([line]), 12000);
  assert.throws(
    () => priceQuantity({ ...product, available: 0 }, line.quantity),
    /stock/i,
  );
  assert.equal(reviewedTotal([line]), 12000);
});
test("quarter, half and three-quarter use whole bottles and configured component prices", () => {
  assert.deepEqual(priceQuantity(product, q(0, 1)), {
    totalBottles: 3,
    lineTotal: 3500,
  });
  assert.deepEqual(priceQuantity(product, q(0, 2)), {
    totalBottles: 6,
    lineTotal: 6500,
  });
  assert.deepEqual(priceQuantity(product, q(0, 3)), {
    totalBottles: 9,
    lineTotal: 10000,
  });
  assert.deepEqual(priceQuantity(product, q(2, 3, 1)), {
    totalBottles: 34,
    lineTotal: 35500,
  });
  assert.deepEqual(
    priceQuantity({ ...product, bottles_per_crate: 20 }, q(1, 3)),
    { totalBottles: 35, lineTotal: 22000 },
  );
  assert.throws(
    () => priceQuantity({ ...product, bottles_per_crate: 13 }, q(0, 1)),
    /whole number of bottles/,
  );
});
test("exact bottles retain the explicit bottle price even when they make a crate", () => {
  assert.deepEqual(priceQuantity(product, q(0, 0, 12)), {
    totalBottles: 12,
    lineTotal: 18000,
  });
  assert.deepEqual(priceQuantity(product, q(13)), {
    totalBottles: 156,
    lineTotal: 156000,
  });
  assert.deepEqual(priceQuantity(product, q(2, 0, 5)), {
    totalBottles: 29,
    lineTotal: 31500,
  });
  assert.equal(saleQuantityLabel(q(1, 3, 2)), "1¾ crates + 2 bottles");
});
test("price change message shows the previous and current payable amount", () => {
  const line = putSaleLine(
    [],
    { productId: product.id, quantity: q(1) },
    product,
  )[0];
  assert.equal(
    salePriceChangeMessage(line, { ...product, full_crate_price: 13000 }),
    "Drink: Price for this quantity changed from ₦12,000 to ₦13,000.",
  );
  assert.equal(salePriceChangeMessage(line, product), null);
});

test("price change message handles multi-crate and partial quantities", () => {
  const line = putSaleLine(
    [],
    { productId: product.id, quantity: q(2, 1, 0) },
    product,
  )[0];
  const changed = {
    ...product,
    full_crate_price: 14000,
    half_crate_price: 7000,
    quarter_crate_price: 4000,
  };
  assert.equal(
    salePriceChangeMessage(line, changed),
    "Drink: Price for this quantity changed from ₦27,500 to ₦32,000.",
  );
});

test("partial crates derive from full price while explicit overrides win", () => {
  const derived = {
    ...product,
    full_crate_price: 14500,
    half_crate_price: null,
    quarter_crate_price: null,
  };
  assert.equal(priceQuantity(derived, q(0, 2)).lineTotal, 7250);
  assert.equal(priceQuantity(derived, q(0, 1)).lineTotal, 3625);
  assert.equal(priceQuantity(derived, q(0, 3)).lineTotal, 10875);
  assert.equal(
    priceQuantity({ ...derived, half_crate_price: 8000 }, q(0, 2)).lineTotal,
    8000,
  );
  assert.equal(
    priceQuantity({ ...derived, quarter_crate_price: 4000 }, q(0, 1))
      .lineTotal,
    4000,
  );
  assert.equal(
    priceQuantity({ ...derived, half_crate_price: 8000 }, q(0, 3))
      .lineTotal,
    11625,
  );
  assert.equal(
    priceQuantity({ ...derived, quarter_crate_price: 4000 }, q(0, 3))
      .lineTotal,
    11250,
  );
  const snapshot = salePriceSnapshot(derived, q(0, 2));
  assert.notEqual(
    snapshot,
    salePriceSnapshot({ ...derived, full_crate_price: 15000 }, q(0, 2)),
  );
  assert.notEqual(
    snapshot,
    salePriceSnapshot({ ...derived, half_crate_price: 8000 }, q(0, 2)),
  );
  assert.notEqual(
    snapshot,
    salePriceSnapshot({ ...derived, quarter_crate_price: 4000 }, q(0, 2)),
  );
});
test("loose bottles never derive from crate price and full crates are unchanged", () => {
  assert.throws(
    () => priceQuantity({ ...product, bottle_price: null }, q(0, 0, 1)),
    /Bottle price is not set/,
  );
  assert.equal(
    priceQuantity({ ...product, half_crate_price: 0 }, q(0, 2)).lineTotal,
    0,
  );
  assert.equal(
    priceQuantity({ ...product, bottle_price: null }, q(1)).lineTotal,
    12000,
  );
});
test("stock checks reject zero, negative, fractional input, missing stock and excess quantities", () => {
  assert.throws(() => priceQuantity(product, q()), /at least/);
  assert.throws(() => priceQuantity(product, q(-1)), /whole numbers/);
  assert.throws(() => priceQuantity(product, q(1.5)), /whole numbers/);
  assert.throws(() => priceQuantity(product, q(0, 0, 1.2)), /whole numbers/);
  assert.throws(
    () => priceQuantity({ ...product, available: null }, q(1)),
    /Stock has not been counted for this drink yet\./,
  );
  assert.throws(
    () => priceQuantity({ ...product, available: 0 }, q(1)),
    /Out of stock/,
  );
  assert.equal(
    priceQuantity({ ...product, available: 9 }, q(0, 3)).totalBottles,
    9,
  );
  assert.throws(
    () => priceQuantity({ ...product, available: 8 }, q(0, 3)),
    /Only 8 bottles available now\. Change the quantity\./,
  );
});
test("stock shortage says exactly what is available in crates and bottles", () => {
  assert.throws(
    () => priceQuantity({ ...product, available: 18 }, q(2)),
    /Only 1 crate \+ 6 bottles available now\. Change the quantity\./,
  );
  assert.throws(
    () => priceQuantity({ ...product, available: 0 }, q(1)),
    /Out of stock\. Change the quantity\./,
  );
});

test("multiple drinks, edit replacement, remove and total use each product's own prices and capacity", () => {
  const second = {
    ...product,
    id: "two",
    bottles_per_crate: 24,
    full_crate_price: 20000,
  };
  const first = putSaleLine(
    [],
    { productId: product.id, quantity: q(1) },
    product,
  );
  const two = putSaleLine(
    first,
    { productId: second.id, quantity: q(2) },
    second,
  );
  assert.equal(saleTotal(two, [product, second]), 52000);
  const edited = putSaleLine(
    two,
    { productId: product.id, quantity: q(0, 2) },
    product,
  );
  assert.equal(edited.length, 2);
  assert.equal(first[0].quantity.crates, 1);
  assert.equal(saleTotal(edited, [product, second]), 46500);
  assert.equal(
    saleTotal(removeSaleLine(edited, second.id), [product, second]),
    6500,
  );
  assert.throws(
    () => saleTotal(two, [{ ...product, available: 1 }, second]),
    /Only 1 bottle available now\. Change the quantity\./,
  );
  assert.throws(() => saleTotal([first[0], first[0]], [product]), /duplicate/);
  assert.throws(() => saleTotal(first, []), /no longer/);
});
test("session draft restores all steps and unfinished quantity text without trusting stored prices", () => {
  const draft = {
    ...emptySaleDraft,
    customerId: "customer",
    step: "quantity" as const,
    editingId: "one",
    crates: "13",
    fraction: 3 as const,
    bottles: "",
    lines: [{ productId: "one", quantity: q(1) }],
  };
  assert.deepEqual(readSaleDraft(JSON.stringify(draft)), draft);
  assert.equal(readSaleDraft("bad"), emptySaleDraft);
  assert.equal(
    readSaleDraft(
      JSON.stringify({
        ...draft,
        lines: [{ productId: "one", quantity: q(-1) }],
      }),
    ),
    emptySaleDraft,
  );
  assert.equal(
    saleTotal(readSaleDraft(JSON.stringify(draft)).lines, [
      { ...product, full_crate_price: 13000 },
    ]),
    13000,
  );
});
test("legacy partial-empty drafts return to empties instead of assuming everything came back", () => {
  const legacy = {
    ...emptySaleDraft,
    step: "review" as const,
    allEmpties: false,
    returns: { one: { crates: "0", bottles: "10" } },
  };
  delete (legacy as Partial<typeof legacy>).emptiesV2;
  const restored = readSaleDraft(JSON.stringify(legacy));
  assert.equal(restored.step, "empties");
  assert.equal(restored.emptiesV2.mode, "actual");
  assert.deepEqual(restored.emptiesV2.returnedCrates, {});
  assert.deepEqual(restored.emptiesV2.returnedBottles, {});
});

test("customer search matches names and Nigerian phone formatting", () => {
  const c = { id: "c", name: "Mama Ada", phone: "+2348012345678", empties_deposit_required: false };
  assert.equal(matchesSaleCustomer(c, "ada"), true);
  assert.equal(matchesSaleCustomer(c, "0801"), true);
  assert.equal(matchesSaleCustomer(c, "0801 234 5678"), true);
  assert.equal(matchesSaleCustomer(c, "elsewhere"), false);
});

 test("24-bottle quantities use full-crate proportions without requiring bottle prices", () => {
  const p = { ...product, bottles_per_crate: 24, full_crate_price: 24000, bottle_price: null };
  for (const eighths of [1,3,5,7] as const) {
    const quantity = { crates: 1, fraction: 0 as const, bottles: 0, eighths };
    assert.deepEqual(priceQuantity(p, quantity), { totalBottles: 24 + eighths * 3, lineTotal: 24000 + eighths * 3000 });
    assert.equal(reviewedTotal([reviewedLine({productId:p.id,quantity},p)]), 24000 + eighths * 3000);
  }
  assert.throws(()=>priceQuantity(product,{crates:0,fraction:0,bottles:0,eighths:1}), /24-bottle/);
  assert.throws(()=>priceQuantity({...p,full_crate_price:10050},{crates:0,fraction:0,bottles:0,eighths:1}), /whole-naira/);
  assert.throws(()=>priceQuantity(p,{crates:0,fraction:1,bottles:0,eighths:1}), /valid/);
  assert.throws(()=>priceQuantity({...p,available:2},{crates:0,fraction:0,bottles:0,eighths:1}), /available/);
 });
