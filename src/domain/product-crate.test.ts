import assert from "node:assert/strict";
import { test } from "node:test";
import { newProductCrate, productCrateLabel } from "./product-crate.ts";
const regular = {
  name: "Regular",
  empty_family: "NBL",
  pocket_count: 12,
  variant: "regular",
  is_legacy: false,
};
test("product crate labels are human-readable without references or duplicate forms", () => {
  assert.equal(
    productCrateLabel({
      ...regular,
      id: "50000000-0000-4000-8000-000000000001",
    }),
    "NBL · 12-pocket · Regular",
  );
  assert.equal(
    productCrateLabel({
      ...regular,
      pocket_count: 20,
      name: "Short",
      variant: "short",
    }),
    "NBL · 20-pocket · Short",
  );
  assert.equal(
    productCrateLabel({
      ...regular,
      empty_family: "Guinness",
      pocket_count: 24,
      name: "Small Stout",
      variant: null,
    }),
    "Guinness · 24-pocket · Small Stout",
  );
  assert.equal(
    productCrateLabel({
      ...regular,
      name: "NBL",
      pocket_count: null,
      variant: null,
      is_legacy: true,
    }),
    "NBL",
  );
});
test("optional distinguishing name uses the owner's variant without inventing identity", () => {
  assert.deepEqual(
    newProductCrate({
      name: "",
      empty_family: " NBL ",
      pocket_count: "12",
      variant: " regular ",
    }),
    {
      name: "regular",
      empty_family: "NBL",
      pocket_count: 12,
      variant: "regular",
    },
  );
  assert.equal(
    newProductCrate({
      name: "Flying Fish",
      empty_family: "International Breweries",
      pocket_count: "20",
      variant: "Short",
    }).name,
    "Flying Fish",
  );
  assert.throws(
    () =>
      newProductCrate({
        name: "",
        empty_family: "NBL",
        pocket_count: "12",
        variant: "",
      }),
    /variant/,
  );
  assert.throws(() =>
    newProductCrate({
      name: "",
      empty_family: "NBL",
      pocket_count: "0",
      variant: "Regular",
    }),
  );
});
