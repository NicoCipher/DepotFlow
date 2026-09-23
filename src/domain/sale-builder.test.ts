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
  saleTotal,
  emptiesFor,
  returnedEmpties,
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
  crate_type: { name: "Exact crate", is_legacy: false, pocket_count: 12 },
  bottles_returnable: true,
  bottle_type: "glass",
};
const q = (crates = 0, fraction: 0 | 1 | 2 | 3 = 0, bottles = 0) => ({
  crates,
  fraction,
  bottles,
});
test("whole crates and loose bottles retain distinct exact obligations", () => {
  const line = { productId: product.id, quantity: q(2, 1, 5) };
  assert.deepEqual(emptiesFor(line, product), { crates: 2, bottles: 32 });
  const draft = {
    ...emptySaleDraft,
    allEmpties: false,
    returns: { one: { crates: "1", bottles: "7" } },
  };
  assert.deepEqual(returnedEmpties(draft, line, product), {
    crates: 1,
    bottles: 7,
  });
  assert.deepEqual(
    returnedEmpties({ ...draft, allEmpties: true }, line, product),
    { crates: 2, bottles: 32 },
  );
  assert.deepEqual(emptiesFor({ ...line, quantity: q(0, 1, 9) }, product), {
    crates: 0,
    bottles: 12,
  });
  assert.deepEqual(
    emptiesFor(line, { ...product, bottles_returnable: false }),
    { crates: 2, bottles: 0 },
  );
  assert.throws(
    () =>
      emptiesFor(line, {
        ...product,
        crate_type: { name: "Unknown", is_legacy: true, pocket_count: 12 },
      }),
    /exact crate/,
  );
  assert.throws(
    () =>
      returnedEmpties(
        { ...draft, returns: { one: { crates: "3", bottles: "7" } } },
        line,
        product,
      ),
    /cannot exceed/,
  );
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
test("missing prices never fall back to division or another unit; explicit zero prices remain valid", () => {
  assert.throws(
    () => priceQuantity({ ...product, half_crate_price: null }, q(0, 2)),
    /Half-crate price is not set/,
  );
  assert.throws(
    () => priceQuantity({ ...product, quarter_crate_price: null }, q(0, 3)),
    /Quarter-crate price is not set/,
  );
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
    /not recorded/,
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
    /all that is in stock/,
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
    /all that is in stock/,
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
test("customer search matches names and Nigerian phone formatting", () => {
  const c = { id: "c", name: "Mama Ada", phone: "+2348012345678" };
  assert.equal(matchesSaleCustomer(c, "ada"), true);
  assert.equal(matchesSaleCustomer(c, "0801"), true);
  assert.equal(matchesSaleCustomer(c, "0801 234 5678"), true);
  assert.equal(matchesSaleCustomer(c, "elsewhere"), false);
});
