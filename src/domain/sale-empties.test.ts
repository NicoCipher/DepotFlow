import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyEmptiesV2,
  matchSaleEmpties,
} from "./sale-empties.ts";
import {
  emptySaleDraft,
  type SaleCatalog,
  type SaleDraft,
  type SaleProduct,
} from "./sale-builder.ts";

const crate = (id: string, name: string, pocket_count = 12) => ({
  id,
  name,
  is_legacy: false,
  pocket_count,
});

function product(
  id: string,
  name: string,
  crateTypeId: string,
  bottleType: string,
  pocket = 12,
): SaleProduct {
  return {
    id,
    name,
    size: null,
    image_url: null,
    bottles_per_crate: pocket,
    full_crate_price: 12000,
    half_crate_price: 6000,
    quarter_crate_price: 3000,
    bottle_price: 1000,
    available: 240,
    crate_type_id: crateTypeId,
    crate_type: {
      name: crateTypeId,
      is_legacy: false,
      pocket_count: pocket,
      empty_family: "Test",
    },
    bottles_returnable: true,
    bottle_type: bottleType,
  };
}

const goldberg = product("goldberg", "Goldberg", "goldberg-crate", "Goldberg bottle");
const trophy = product("trophy", "Trophy", "trophy-crate", "Trophy bottle");
const big = product("big", "Big", "big-crate", "Big bottle", 20);

const catalog: SaleCatalog = {
  products: [goldberg, trophy, big],
  customers: [
    {
      id: "customer",
      name: "Customer",
      phone: "+2348000000000",
      empties_deposit_required: false,
    },
  ],
  crateTypes: [
    crate("goldberg-crate", "Goldberg"),
    crate("trophy-crate", "Trophy"),
    crate("big-crate", "Big", 20),
  ],
  swapRules: [
    {
      owed_crate_type_id: "goldberg-crate",
      returned_crate_type_id: "trophy-crate",
    },
  ],
};

function sale(productId: string, crates = 1): SaleDraft {
  return {
    ...emptySaleDraft,
    customerId: "customer",
    lines: [
      {
        productId,
        quantity: { crates, fraction: 0, bottles: 0 },
      },
    ],
    emptiesV2: {
      ...emptyEmptiesV2,
      mode: "actual",
      cratesTaken: {},
      returnedCrates: {},
      returnedBottles: {},
    },
  };
}

test("exact complete return settles crate and bottles", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates["goldberg-crate"] = "1";
  draft.emptiesV2.returnedBottles["Goldberg bottle"] = "12";
  const result = matchSaleEmpties(draft, catalog);
  assert.equal(result.hasShortage, false);
  assert.equal(result.lines[0].cratesOwed, 0);
  assert.equal(result.lines[0].bottlesOwed, 0);
});

test("one crate worth sold in a sack has no crate obligation", () => {
  const draft = sale("trophy");
  draft.emptiesV2.cratesTaken.trophy = "0";
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "12";
  const result = matchSaleEmpties(draft, catalog);
  assert.equal(result.lines[0].cratesOut, 0);
  assert.equal(result.lines[0].cratesOwed, 0);
  assert.equal(result.lines[0].bottlesOwed, 0);
});

test("allowed complete crate swap settles the whole package", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates["trophy-crate"] = "1";
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "12";
  const result = matchSaleEmpties(draft, catalog);
  assert.equal(result.hasShortage, false);
  assert.deepEqual(result.swaps, [
    {
      owedCrateTypeId: "goldberg-crate",
      returnedCrateTypeId: "trophy-crate",
      quantity: 1,
    },
  ]);
});

test("swap does not happen when the returned crate is incomplete", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates["trophy-crate"] = "1";
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "10";
  const result = matchSaleEmpties(draft, catalog);
  assert.equal(result.lines[0].cratesOwed, 1);
  assert.equal(result.lines[0].bottlesOwed, 12);
  assert.equal(result.unmatchedCrates["trophy-crate"], 1);
  assert.equal(result.unmatchedBottles["Trophy bottle"], 10);
});

test("exact crate with wrong bottles settles only the facts that match", () => {
  const draft = sale("trophy");
  draft.emptiesV2.returnedCrates["trophy-crate"] = "1";
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "10";
  draft.emptiesV2.returnedBottles["Goldberg bottle"] = "2";
  const result = matchSaleEmpties(draft, catalog);
  assert.equal(result.lines[0].cratesOwed, 0);
  assert.equal(result.lines[0].bottlesOwed, 2);
  assert.equal(result.unmatchedBottles["Goldberg bottle"], 2);
});

test("different pocket counts are not silently swapped", () => {
  const local: SaleCatalog = {
    ...catalog,
    swapRules: [
      {
        owed_crate_type_id: "goldberg-crate",
        returned_crate_type_id: "big-crate",
      },
    ],
  };
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates["big-crate"] = "1";
  draft.emptiesV2.returnedBottles["Big bottle"] = "20";
  const result = matchSaleEmpties(draft, local);
  assert.equal(result.lines[0].cratesOwed, 1);
  assert.equal(result.lines[0].bottlesOwed, 12);
});
