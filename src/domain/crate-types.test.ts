import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCrateType, crateLabel, crateMatches } from "./crate-types.ts";
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
test("legacy unknown attributes are labelled instead of invented", () => {
  const label = crateLabel({
    name: "NBL",
    empty_family: "NBL",
    pocket_count: null,
    variant: null,
    is_legacy: true,
  });
  assert.match(label, /Unresolved legacy/);
  assert.match(label, /Pockets not recorded/);
  assert.match(crateLabel(attributes), /12-pocket/);
  assert.notEqual(
    crateLabel({ ...attributes, id: "50000000-0000-4000-8000-000000000001" }),
    crateLabel({ ...attributes, id: "50000000-0000-4000-8000-000000000002" }),
  );
});
