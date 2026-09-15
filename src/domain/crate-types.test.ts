import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateCrateType,
  crateLabel,
  crateMatches,
  crateDescription,
  crateFitsProduct,
  crateNeedsSetup,
} from "./crate-types.ts";
import {
  emptyProduct,
  validateProduct,
  sameProductDetails,
} from "./products.ts";
const attributes = {
  name: "Regular",
  empty_family: "NBL",
  pocket_count: 12,
  variant: "regular",
  is_legacy: false,
};
test("matching physical attributes never select or merge an exact product crate identity", () => {
  const product = {
    ...emptyProduct,
    name: "Drink",
    bottles_per_crate: "12",
    bottles_returnable: "false",
    full_crate_price: "0",
  };
  const first = validateProduct({
    ...product,
    crate_type_id: "50000000-0000-4000-8000-000000000001",
  });
  const second = validateProduct({
    ...product,
    crate_type_id: "50000000-0000-4000-8000-000000000002",
  });
  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.equal(sameProductDetails(first.data, second.data), false);
  assert.equal(
    validateProduct({ ...product, crate_type_id: "NBL" }).valid,
    false,
  );
  assert.equal(crateMatches(attributes, "NBL", "12"), true);
  assert.equal(
    crateMatches({ ...attributes, pocket_count: 20 }, "NBL", "12"),
    false,
  );
});
test("pockets allow Other positive integers without being limited to presets", () => {
  for (const pocket_count of ["12", "20", "24", "18", "1", "2147483647"])
    assert.equal(
      validateCrateType({
        name: "Separate identity",
        empty_family: "NBL",
        pocket_count,
        variant: "",
      }).pocket_count,
      Number(pocket_count),
    );
  for (const pocket_count of [
    "0",
    "-1",
    "12.5",
    "",
    "NaN",
    "Infinity",
    "1e2",
    "2147483648",
  ])
    assert.throws(() =>
      validateCrateType({
        name: "Separate identity",
        empty_family: "NBL",
        pocket_count,
        variant: "",
      }),
    );
});
test("crate labels show names and attributes without internal references or duplicate forms", () => {
  const unresolved = {
    ...attributes,
    name: "NBL",
    pocket_count: null,
    variant: null,
    is_legacy: true,
  };
  assert.equal(crateLabel(unresolved), "NBL");
  assert.equal(crateNeedsSetup(unresolved), true);
  assert.equal(crateDescription(attributes), "NBL · 12-pocket");
  assert.equal(
    crateDescription({
      ...attributes,
      name: "33 Export crate",
      variant: "Regular",
    }),
    "NBL · 12-pocket · Regular",
  );
  assert.equal(
    crateLabel({ ...attributes, id: "50000000-0000-4000-8000-000000000001" }),
    "Regular · NBL · 12-pocket",
  );
  assert.equal(
    crateLabel({ ...attributes, id: "50000000-0000-4000-8000-000000000002" }),
    "Regular · NBL · 12-pocket",
  );
  assert.doesNotMatch(
    crateLabel(unresolved),
    /legacy|ref|uuid|migration|database/i,
  );
  assert.equal(crateNeedsSetup({ ...attributes, is_legacy: true }), true);
});
test("resolved pockets match product bottles; unknown pockets remain exempt", () => {
  assert.equal(crateFitsProduct(12, 12), true);
  assert.equal(crateFitsProduct(12, 20), false);
  assert.equal(crateFitsProduct(null, 20), true);
});
