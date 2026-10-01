import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crateReturnIssues,
  depositSetupIssues,
  emptyEmptiesV2,
  matchSaleEmpties,
  missingEmptiesMessage,
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

test("cleared visible empties count stays invalid instead of silently becoming zero", () => {
  const draft = sale("trophy");
  draft.emptiesV2.returnedCrates["trophy-crate"] = "";
  assert.throws(
    () => matchSaleEmpties(draft, catalog),
    /highlighted empties fields/,
  );
});

test("cleared physical-crate count does not silently fall back to crates sold", () => {
  const draft = sale("trophy");
  draft.emptiesV2.cratesTaken.trophy = "";
  assert.throws(
    () => matchSaleEmpties(draft, catalog),
    /highlighted empties fields/,
  );
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

test("missing complete crate deposit price is identified without guessing", () => {
  const draft = sale("trophy");
  const result = matchSaleEmpties(draft, catalog);
  assert.deepEqual(depositSetupIssues(result, catalog), [
    {
      key: "complete:12",
      message:
        "Deposit price for a complete 12-pocket crate has not been set.",
    },
  ]);
});

test("missing bottle and crate-only deposit prices are identified separately", () => {
  const bottlesMissing = sale("trophy");
  bottlesMissing.emptiesV2.returnedCrates["trophy-crate"] = "1";
  const bottlesResult = matchSaleEmpties(bottlesMissing, catalog);
  assert.deepEqual(depositSetupIssues(bottlesResult, catalog), [
    {
      key: "bottle",
      message: "Deposit price per bottle has not been set.",
    },
  ]);

  const crateMissing = sale("trophy");
  crateMissing.emptiesV2.returnedBottles["Trophy bottle"] = "12";
  const crateResult = matchSaleEmpties(crateMissing, catalog);
  assert.deepEqual(depositSetupIssues(crateResult, catalog), [
    {
      key: "crate-only:12",
      message:
        "Deposit price for an empty 12-pocket crate has not been set.",
    },
  ]);
});

test("configured deposit prices produce no setup error", () => {
  const configured: SaleCatalog = {
    ...catalog,
    bottleDepositPrice: 200,
    crateDepositPrices: [
      {
        pocket_count: 12,
        complete_crate_amount: 3000,
        crate_only_amount: 600,
      },
    ],
  };
  const draft = sale("trophy");
  const result = matchSaleEmpties(draft, configured);
  assert.deepEqual(depositSetupIssues(result, configured), []);
});

test("missing empties message says exactly what is still missing", () => {
  assert.equal(
    missingEmptiesMessage({ cratesOwed: 0, bottlesOwed: 2 }, "Trophy"),
    "Trophy: 2 bottles still missing.",
  );
  assert.equal(
    missingEmptiesMessage({ cratesOwed: 1, bottlesOwed: 2 }, "Goldberg"),
    "Goldberg: 1 crate · 2 bottles still missing.",
  );
  assert.equal(
    missingEmptiesMessage({ cratesOwed: 0, bottlesOwed: 0 }, "Trophy"),
    "Trophy: Empties are complete.",
  );
});

test("incompatible returned crate is explained against the one crate still owed", () => {
  const draft = sale("trophy");
  draft.emptiesV2.returnedCrates["goldberg-crate"] = "1";
  draft.emptiesV2.returnedBottles["Goldberg bottle"] = "12";
  const result = matchSaleEmpties(draft, catalog);
  assert.deepEqual(crateReturnIssues(result, catalog), [
    {
      returnedCrateTypeId: "goldberg-crate",
      quantity: 1,
      owedCrateTypeId: "trophy-crate",
      reason: "not_allowed",
    },
  ]);
});

test("allowed swap that is not complete is explained instead of called incompatible", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates["trophy-crate"] = "1";
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "10";
  const result = matchSaleEmpties(draft, catalog);
  assert.deepEqual(crateReturnIssues(result, catalog), [
    {
      returnedCrateTypeId: "trophy-crate",
      quantity: 1,
      owedCrateTypeId: "goldberg-crate",
      reason: "incomplete_allowed_swap",
      matchingBottlesReturned: 10,
      matchingBottlesNeeded: 12,
    },
  ]);
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

test("Goldberg and Trophy: hold wrong crate while correct bottles settle separately", () => {
  const draft = sale("goldberg");
  draft.lines.push(sale("trophy").lines[0]);
  draft.emptiesV2.returnedCrates = { "trophy-crate": "2" };
  draft.emptiesV2.returnedBottles = { "Goldberg bottle": "12", "Trophy bottle": "12" };
  draft.emptiesV2.decisions = [{ productId: "goldberg", kind: "crate", returnedType: "trophy-crate", quantity: "1", decision: "hold" }];
  const result = matchSaleEmpties(draft, catalog);
  assert.deepEqual(result.lines.map(row => [row.cratesOwed,row.bottlesOwed]), [[1,0],[0,0]]);
  assert.deepEqual(result.unmatchedCrates, {});
  assert.equal(result.decisions[0].decision, "hold");
  draft.emptiesV2.decisions[0].decision = "accept";
  assert.equal(matchSaleEmpties(draft, catalog).hasShortage, false);
});

test("wrong crate and wrong bottles can be held or accepted independently", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates = { "trophy-crate": "1" };
  draft.emptiesV2.returnedBottles = { "Trophy bottle": "12" };
  draft.emptiesV2.decisions = [
    { productId: "goldberg", kind: "crate", returnedType: "trophy-crate", quantity: "1", decision: "accept" },
    { productId: "goldberg", kind: "bottle", returnedType: "Trophy bottle", quantity: "12", decision: "hold" },
  ];
  let result = matchSaleEmpties(draft, catalog);
  assert.equal(result.lines[0].cratesOwed, 0);
  assert.equal(result.lines[0].bottlesOwed, 12);
  assert.equal(result.swaps.length, 0);
  draft.emptiesV2.decisions[1].decision = "accept";
  result = matchSaleEmpties(draft, catalog);
  assert.equal(result.hasShortage, false);
  draft.emptiesV2.decisions.push({ ...draft.emptiesV2.decisions[1] });
  assert.throws(() => matchSaleEmpties(draft, catalog));
});

test("explicit choices cannot consume another drink's exact empties or different crate capacities", () => {
  const draft = sale("goldberg");
  draft.lines.push(sale("trophy").lines[0]);
  draft.emptiesV2.returnedCrates = { "trophy-crate": "1" };
  draft.emptiesV2.returnedBottles = { "Trophy bottle": "12" };
  draft.emptiesV2.decisions = [{ productId: "goldberg", kind: "crate", returnedType: "trophy-crate", quantity: "1", decision: "accept" }];
  assert.throws(() => matchSaleEmpties(draft, catalog));
  draft.emptiesV2.returnedCrates = { "big-crate": "1" };
  draft.emptiesV2.decisions[0].returnedType = "big-crate";
  assert.throws(() => matchSaleEmpties(draft, catalog), /same number of spaces/);
  draft.emptiesV2.decisions[0].decision = "hold";
  assert.equal(matchSaleEmpties(draft, catalog).lines[0].cratesOwed, 1);
});

test("a hold reserves the wrong empties before unrelated permanent swaps", () => {
  const other = product("other", "Other NB drink", "goldberg-crate", "Goldberg bottle");
  const draft = sale("goldberg");
  draft.lines.push(sale("trophy").lines[0], sale("other").lines[0]);
  draft.emptiesV2.returnedCrates = { "trophy-crate": "3" };
  draft.emptiesV2.returnedBottles = { "Goldberg bottle": "12", "Trophy bottle": "24" };
  draft.emptiesV2.decisions = [{ productId: "goldberg", kind: "crate", returnedType: "trophy-crate", quantity: "1", decision: "hold" }];
  const result = matchSaleEmpties(draft, { ...catalog, products: [...catalog.products, other] });
  assert.deepEqual(result.lines.map(row => [row.cratesOwed,row.bottlesOwed]), [[1,0],[0,0],[0,0]]);
  assert.equal(result.swaps.length, 1);
  assert.equal(result.swaps[0].quantity, 1);
});
