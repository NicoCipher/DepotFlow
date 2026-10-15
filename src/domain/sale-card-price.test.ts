import assert from "node:assert/strict";
import { test } from "node:test";
import { saleCardPrice } from "./sale-card-price.ts";
import type { SaleProduct } from "./sale-builder.ts";

const drink: SaleProduct = {
  id: "drink", name: "Goldberg", size: null, image_url: null,
  bottles_per_crate: 12, full_crate_price: 12000,
  half_crate_price: 6500, quarter_crate_price: 3500,
  bottle_price: 1500, available: 240,
  crate_type_id: "crate", crate_type: {
    name: "Goldberg", is_legacy: false, pocket_count: 12, empty_family: "NB",
  },
  bottles_returnable: true, bottle_type: "Goldberg bottle",
};

test("retail product cards prioritize bottle prices without changing sale pricing", () => {
  const price = saleCardPrice(drink, "retail");
  assert.equal(price.primary, "₦1,500 / bottle");
  assert.match(price.secondary, /Retail/);
  assert.equal(price.available, true);
  assert.equal(drink.full_crate_price, 12000);
});

test("wholesale product cards prioritize crate prices and distinguish extra loose bottles", () => {
  const price = saleCardPrice(drink, "wholesale");
  assert.equal(price.primary, "₦12,000 / crate");
  assert.match(price.secondary, /loose bottles.*₦1,500/);
  assert.equal(price.available, true);
});

test("a missing retail bottle price is clearly unavailable without displaying a misleading wholesale price", () => {
  const price = saleCardPrice({ ...drink, bottle_price: null }, "retail");
  assert.equal(price.available, false);
  assert.match(price.primary, /Retail bottle price not set/);
  assert.doesNotMatch(price.primary, /₦12,000/);
});

test("a missing crate price is explicit in wholesale and a bottle price is not used as crate price", () => {
  const price = saleCardPrice({ ...drink, full_crate_price: null }, "wholesale");
  assert.equal(price.available, false);
  assert.match(price.primary, /Wholesale crate price not set/);
  assert.match(price.secondary, /₦1,500/);
});
