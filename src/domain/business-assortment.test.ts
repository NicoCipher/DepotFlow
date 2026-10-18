import assert from "node:assert/strict";
import test from "node:test";
import { parseBusinessAssortment, validateDrinkSetup } from "./business-assortment.ts";

const business = "89f00000-0000-4000-9000-000000000021";
const sample = {
  businessId: business, businessStatus: "setup", readOnly: true, canActivate: false,
  catalogue: [{ id: business, name: "Goldberg", manufacturer: "NB", imagePath: null }],
  crateTypes: [{ id: business, name: "NBL shared", family: "NBL", pockets: 20, variant: null }],
  configuredDrinks: [{ id: business, catalogueId: business, name: "Goldberg",
    crateTypeId: business, packSize: 20, sellingPrice: 10000, active: true,
    returnable: true, bottleType: "Goldberg bottle" }],
};

test("owner assortment DTO rejects a foreign business or activation flag", () => {
  assert.ok(parseBusinessAssortment(sample, business));
  assert.equal(parseBusinessAssortment(sample, "89f00000-0000-4000-9000-000000000022"), null);
  assert.equal(parseBusinessAssortment({ ...sample, canActivate: true }, business), null);
  assert.equal(parseBusinessAssortment({ ...sample, crateTypes: "not-an-array" }, business), null);
});

test("selling prices use ₦50 increments and pack size is explicit", () => {
  assert.equal(validateDrinkSetup({ price: 10000, pack: 20, bottlePrice: 500,
    returnable: true, bottleType: "Goldberg bottle" }), null);
  assert.match(validateDrinkSetup({ price: 10025, pack: 20, bottlePrice: null,
    returnable: true, bottleType: "Goldberg bottle" })!, /₦50/);
  assert.match(validateDrinkSetup({ price: 10000, pack: 0, bottlePrice: null,
    returnable: false, bottleType: "" })!, /bottles-per-crate/);
  assert.match(validateDrinkSetup({ price: 10000, pack: 20, bottlePrice: null,
    returnable: true, bottleType: "" })!, /returnable bottle/);
});
