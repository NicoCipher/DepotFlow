import assert from "node:assert/strict";
import { bulkReturnGroups, bulkReturnParts, updateBulkReturnParts } from "./bulk-empties.ts";
import { test } from "node:test";
import {
  crateReturnIssues,
  assertSaleEmptiesResolved,
  actualSaleEmpties,
  allReturnedConfirmationKey,
  assertAllReturnedConfirmed,
  hasConfirmedAllReturned,
  hasNoExpectedSaleEmpties,
  isQuickRetailEmptiesSale,
  paymentStepAfterEmpties,
  hasUnmatchedSaleEmpties,
  depositSetupIssues,
  emptyEmptiesV2,
  matchSaleEmpties,
  missingEmptiesMessage,
  simpleBottleReturnChoice,
} from "./sale-empties.ts";
import {
  emptySaleDraft,
  readSaleDraft,
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

test("single wrong bottle choice stays simple inside a multi-drink sale", () => {
  const draft = sale("goldberg", 0);
  draft.lines[0].quantity = { crates: 0, fraction: 0, bottles: 1 };
  draft.lines.push({ productId: "trophy", quantity: { crates: 0, fraction: 0, bottles: 2 } });
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "3";
  const result = matchSaleEmpties(draft, catalog);
  const suggestion = simpleBottleReturnChoice(result);
  assert.deepEqual(suggestion, {
    productId: "goldberg",
    expectedType: "Goldberg bottle",
    returnedType: "Trophy bottle",
    quantity: 1,
  });
  draft.emptiesV2.decisions = [{
    productId: suggestion!.productId,
    kind: "bottle",
    returnedType: suggestion!.returnedType,
    quantity: String(suggestion!.quantity),
    decision: "accept",
  }];
  const settled = matchSaleEmpties(draft, catalog);
  assert.equal(settled.lines.find((line) => line.productId === "goldberg")?.bottlesOwed, 0);
  assert.equal(settled.unmatchedBottles["Trophy bottle"], undefined);
});

test("never guess which drink a different bottle replaces when multiple types are owed", () => {
  const draft = sale("goldberg", 0);
  draft.lines[0].quantity = { crates: 0, fraction: 0, bottles: 1 };
  draft.lines.push({ productId: "big", quantity: { crates: 0, fraction: 0, bottles: 1 } });
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "1";
  assert.equal(simpleBottleReturnChoice(matchSaleEmpties(draft, catalog)), null);
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

test("a different loose bottle decision keeps the already valid complete crate swap", () => {
  for (const decision of ["accept", "hold"] as const) {
    const draft = sale("goldberg");
    // A full 12-bottle Goldberg crate and one loose Goldberg bottle went out.
    draft.lines[0].quantity = { crates: 1, fraction: 0, bottles: 1 };
    // A permitted complete Trophy crate plus one extra Trophy bottle returned.
    draft.emptiesV2.returnedCrates["trophy-crate"] = "1";
    draft.emptiesV2.returnedBottles["Trophy bottle"] = "13";

    const before = matchSaleEmpties(draft, catalog);
    assert.equal(before.swaps.length, 1);
    assert.deepEqual(before.unmatchedBottles, { "Trophy bottle": 1 });
    assert.deepEqual(simpleBottleReturnChoice(before), {
      productId: "goldberg",
      expectedType: "Goldberg bottle",
      returnedType: "Trophy bottle",
      quantity: 1,
    });

    draft.emptiesV2.decisions = [{
      productId: "goldberg",
      kind: "bottle",
      returnedType: "Trophy bottle",
      quantity: "1",
      decision,
    }];
    const after = matchSaleEmpties(draft, catalog);
    assert.deepEqual(after.swaps, before.swaps);
    assert.deepEqual(after.unmatchedCrates, {});
    assert.deepEqual(after.unmatchedBottles, {});
    assert.equal(after.lines[0].cratesOwed, 0);
    assert.equal(after.lines[0].bottlesOwed, decision === "accept" ? 0 : 1);
    assert.equal(after.lines[0].cratesSettled, 1);
    assert.equal(after.lines[0].bottlesSettled, decision === "accept" ? 13 : 12);
    assert.doesNotThrow(() => assertSaleEmptiesResolved(after));
  }
});

test("cannot hold or accept more wrong bottles than remain owed after a crate swap", () => {
  for (const decision of ["hold", "accept"] as const) {
    const draft = sale("goldberg");
    draft.lines[0].quantity = { crates: 1, fraction: 0, bottles: 1 };
    draft.emptiesV2.returnedCrates["trophy-crate"] = "1";
    // A permitted crate swap uses 12 of the 14 returned Trophy bottles.
    // Only *one* Goldberg bottle is still owed, so a choice of two is invalid.
    draft.emptiesV2.returnedBottles["Trophy bottle"] = "14";
    const before = matchSaleEmpties(draft, catalog);
    assert.equal(before.lines[0].bottlesOwed, 1);
    draft.emptiesV2.decisions = [{
      productId: "goldberg",
      kind: "bottle",
      returnedType: "Trophy bottle",
      quantity: "2",
      decision,
    }];
    assert.throws(
      () => matchSaleEmpties(draft, catalog),
      /only for what is still owed/,
    );
  }
});

test("a held extra bottle does not make an additional returned bottle disappear", () => {
  const draft = sale("goldberg");
  draft.lines[0].quantity = { crates: 1, fraction: 0, bottles: 1 };
  draft.emptiesV2.returnedCrates["trophy-crate"] = "1";
  draft.emptiesV2.returnedBottles["Trophy bottle"] = "14";
  draft.emptiesV2.decisions = [{
    productId: "goldberg",
    kind: "bottle",
    returnedType: "Trophy bottle",
    quantity: "1",
    decision: "hold",
  }];
  const result = matchSaleEmpties(draft, catalog);
  assert.equal(result.swaps.length, 1);
  assert.equal(result.lines[0].bottlesOwed, 1);
  assert.deepEqual(result.unmatchedBottles, { "Trophy bottle": 1 });
  assert.throws(() => assertSaleEmptiesResolved(result), /Accept or Hold/);
});

test("bottle decision does not undo automatic crate swap in a multi-drink sale", () => {
  const draft = sale("goldberg");
  draft.lines[0].quantity = { crates: 1, fraction: 0, bottles: 1 };
  draft.lines.push({ productId: "big", quantity: { crates: 0, fraction: 0, bottles: 2 } });
  draft.emptiesV2.returnedCrates = { "trophy-crate": "1" };
  draft.emptiesV2.returnedBottles = { "Trophy bottle": "13", "Big bottle": "2" };
  const before = matchSaleEmpties(draft, catalog);
  assert.ok(simpleBottleReturnChoice(before));
  draft.emptiesV2.decisions = [{
    productId: "goldberg", kind: "bottle", returnedType: "Trophy bottle",
    quantity: "1", decision: "accept",
  }];
  const after = matchSaleEmpties(draft, catalog);
  assert.deepEqual(after.swaps, before.swaps);
  assert.deepEqual(after.lines.map(row => [row.cratesOwed, row.bottlesOwed]), [[0, 0], [0, 0]]);
  assert.deepEqual(after.unmatchedBottles, {});
  assert.doesNotThrow(() => assertSaleEmptiesResolved(after));
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
        "Deposit price for a complete 12-pocket empty-crate set has not been set.",
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
      message: "Deposit price per empty bottle has not been set.",
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
    "Trophy: 2 empty bottles still owed after this sale.",
  );
  assert.equal(
    missingEmptiesMessage({ cratesOwed: 1, bottlesOwed: 2 }, "Goldberg"),
    "Goldberg: 1 empty crate · 2 empty bottles still owed after this sale.",
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

test("unmatched wrong returns require an explicit choice before saving", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates = { "trophy-crate": "1" };
  draft.emptiesV2.returnedBottles = { "Goldberg bottle": "12" };
  const result = matchSaleEmpties(draft, { ...catalog, swapRules: [] });
  assert.equal(hasUnmatchedSaleEmpties(result), true);
  assert.throws(() => assertSaleEmptiesResolved(result), /Choose Accept or Hold/);
  draft.emptiesV2.decisions = [{ productId: "goldberg", kind: "crate", returnedType: "trophy-crate", quantity: "1", decision: "hold" }];
  assert.doesNotThrow(() => assertSaleEmptiesResolved(matchSaleEmpties(draft, catalog)));
});

test("all-returned mode requires an explicit confirmation, even when every expected empty matches", () => {
  const draft = sale("goldberg", 2);
  draft.emptiesV2.mode = "exact";
  const match = matchSaleEmpties(draft, catalog);
  assert.equal(match.hasShortage, false);
  assert.equal(match.lines[0].cratesSettled, 2);
  assert.equal(match.lines[0].bottlesSettled, 24);
  assert.equal(hasConfirmedAllReturned(draft, match), false);
  assert.throws(() => assertAllReturnedConfirmed(draft, match), /Confirm the empty crates and empty bottles/);
  assert.throws(() => actualSaleEmpties(draft, catalog), /Confirm the empty crates and empty bottles/);
});

test("confirmed complete return records physical stock by exact crate and bottle type with no shortage", () => {
  const draft = sale("goldberg", 2);
  draft.lines.push({ productId: "trophy", quantity: { crates: 1, fraction: 0, bottles: 0 } });
  draft.emptiesV2.mode = "exact";
  const match = matchSaleEmpties(draft, catalog);
  draft.emptiesV2.confirmedAllReturned = allReturnedConfirmationKey(draft, match);
  assert.equal(hasConfirmedAllReturned(draft, match), true);
  assert.doesNotThrow(() => assertAllReturnedConfirmed(draft, match));
  const actual = actualSaleEmpties(draft, catalog);
  assert.deepEqual(actual.crates, [
    { crateTypeId: "goldberg-crate", quantity: 2 },
    { crateTypeId: "trophy-crate", quantity: 1 },
  ]);
  assert.deepEqual(actual.bottles, [
    { bottleType: "Goldberg bottle", quantity: 24 },
    { bottleType: "Trophy bottle", quantity: 12 },
  ]);
  assert.equal(match.hasShortage, false);
  assert.deepEqual(match.lines.map(line => [line.cratesOwed, line.bottlesOwed]), [[0, 0], [0, 0]]);
});

test("changing customer, quantity, crate carried or expected bottle type invalidates all-returned confirmation", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.mode = "exact";
  draft.emptiesV2.confirmedAllReturned = allReturnedConfirmationKey(draft, matchSaleEmpties(draft, catalog));
  const changedCustomer = { ...draft, customerId: "different customer" };
  assert.equal(hasConfirmedAllReturned(changedCustomer, matchSaleEmpties(changedCustomer, catalog)), false);
  const changedQuantity = { ...draft, lines: [{ ...draft.lines[0], quantity: { crates: 2, fraction: 0 as const, bottles: 0 } }] };
  assert.equal(hasConfirmedAllReturned(changedQuantity, matchSaleEmpties(changedQuantity, catalog)), false);
  const changedCrates = { ...draft, emptiesV2: { ...draft.emptiesV2, cratesTaken: { goldberg: "0" } } };
  assert.equal(hasConfirmedAllReturned(changedCrates, matchSaleEmpties(changedCrates, catalog)), false);
  const changedCatalog = { ...catalog, products: catalog.products.map(p => p.id === "goldberg" ? { ...p, bottle_type: "New Goldberg bottle" } : p) };
  assert.equal(hasConfirmedAllReturned(draft, matchSaleEmpties(draft, changedCatalog)), false);
});

test("resumed all-returned drafts retain confirmation; older unconfirmed drafts return to the empties step", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.mode = "exact";
  draft.step = "review";
  draft.emptiesV2.confirmedAllReturned = allReturnedConfirmationKey(draft, matchSaleEmpties(draft, catalog));
  const resumed = readSaleDraft(JSON.stringify(draft));
  assert.equal(resumed.step, "review");
  assert.equal(hasConfirmedAllReturned(resumed, matchSaleEmpties(resumed, catalog)), true);

  const olderDraft = { ...draft, emptiesV2: { ...draft.emptiesV2, confirmedAllReturned: null } };
  assert.equal(readSaleDraft(JSON.stringify(olderDraft)).step, "empties");
});

test("manual actual-return path remains available without all-returned confirmation", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.returnedCrates["goldberg-crate"] = "1";
  draft.emptiesV2.returnedBottles["Goldberg bottle"] = "12";
  const match = matchSaleEmpties(draft, catalog);
  assert.doesNotThrow(() => assertAllReturnedConfirmed(draft, match));
  assert.equal(actualSaleEmpties(draft, catalog).crates[0].quantity, 1);
});

test("sales with no crates or returnable bottles can skip empties confirmation safely", () => {
  const dry = {
    ...goldberg,
    id: "can",
    name: "Nonreturnable can",
    crate_type_id: "goldberg-crate",
    bottles_returnable: false,
    bottle_type: null,
  };
  const nonreturnableCatalog = { ...catalog, products: [...catalog.products, dry] };
  const draft = sale("can", 0);
  draft.lines[0].quantity = { crates: 0, fraction: 0, bottles: 3 };
  draft.emptiesV2.mode = "exact";
  const match = matchSaleEmpties(draft, nonreturnableCatalog);
  assert.equal(hasNoExpectedSaleEmpties(match), true);
  assert.equal(hasConfirmedAllReturned(draft, match), true);
  assert.deepEqual(actualSaleEmpties(draft, nonreturnableCatalog), { crates: [], bottles: [] });
});

test("returnable loose bottles and full crates still require checking", () => {
  const loose = sale("goldberg", 0);
  loose.lines[0].quantity = { crates: 0, fraction: 0, bottles: 3 };
  loose.emptiesV2.mode = "exact";
  const looseMatch = matchSaleEmpties(loose, catalog);
  assert.equal(hasNoExpectedSaleEmpties(looseMatch), false);
  assert.equal(hasConfirmedAllReturned(loose, looseMatch), false);

  const full = sale("goldberg", 1);
  full.emptiesV2.mode = "exact";
  assert.equal(hasNoExpectedSaleEmpties(matchSaleEmpties(full, catalog)), false);
});

test("no-empties fast path survives draft reload, but changed obligations are not confirmed", () => {
  const nonreturnable = { ...goldberg, id: "dry", name: "Nonreturnable", bottles_returnable: false, bottle_type: null };
  const dryCatalog = { ...catalog, products: [...catalog.products, nonreturnable] };
  const draft = sale("dry", 0);
  draft.lines[0].quantity = { crates: 0, fraction: 0, bottles: 3 };
  draft.emptiesV2.mode = "exact";
  const match = matchSaleEmpties(draft, dryCatalog);
  assert.equal(hasNoExpectedSaleEmpties(match), true);
  draft.emptiesV2.confirmedAllReturned = allReturnedConfirmationKey(draft, match);
  draft.step = "payment";
  const resumedPayment = readSaleDraft(JSON.stringify(draft));
  assert.equal(resumedPayment.step, "payment");
  assert.equal(hasConfirmedAllReturned(resumedPayment, matchSaleEmpties(resumedPayment, dryCatalog)), true);

  draft.step = "review";
  const resumedReview = readSaleDraft(JSON.stringify(draft));
  assert.equal(resumedReview.step, "review");

  const returnable = {
    ...dryCatalog,
    products: dryCatalog.products.map((p) =>
      p.id === "dry" ? { ...p, bottles_returnable: true, bottle_type: "Goldberg bottle" } : p),
  };
  const changed = matchSaleEmpties(resumedReview, returnable);
  assert.equal(hasNoExpectedSaleEmpties(changed), false);
  assert.equal(hasConfirmedAllReturned(resumedReview, changed), false);
  assert.throws(() => assertAllReturnedConfirmed(resumedReview, changed), /Confirm the empty crates and empty bottles/);
});

test("in-step zero-obligation return saves a durable confirmation when proceeding to payment", () => {
  const withoutBottles = {
    ...goldberg,
    bottles_returnable: false,
    bottle_type: null,
  };
  const dryCatalog = { ...catalog, products: [withoutBottles, trophy, big] };
  const draft = sale("goldberg");
  draft.emptiesV2.mode = "exact";
  // Whole crate sold, but customer carries its bottles without plastic crate.
  draft.emptiesV2.cratesTaken = { goldberg: "0" };
  const preview = matchSaleEmpties(draft, dryCatalog);
  assert.equal(hasNoExpectedSaleEmpties(preview), true);
  assert.equal(draft.emptiesV2.confirmedAllReturned ?? null, null);
  const patch = paymentStepAfterEmpties(draft, preview);
  const resumed = readSaleDraft(JSON.stringify({ ...draft, ...patch }));
  assert.equal(resumed.step, "payment");
  assert.equal(resumed.emptiesV2.mode, "exact");
  assert.equal(hasConfirmedAllReturned(resumed, matchSaleEmpties(resumed, dryCatalog)), true);

  const updatedCatalog = {
    ...dryCatalog,
    products: [goldberg, trophy, big],
  };
  const changed = matchSaleEmpties(resumed, updatedCatalog);
  assert.equal(hasNoExpectedSaleEmpties(changed), false);
  assert.equal(hasConfirmedAllReturned(resumed, changed), false);
  assert.throws(() => assertAllReturnedConfirmed(resumed, changed), /Confirm the empty crates and empty bottles/);
});

test("continuing from unconfirmed all-returned crates cannot forge confirmation", () => {
  const draft = sale("goldberg");
  draft.emptiesV2.mode = "exact";
  const preview = matchSaleEmpties(draft, catalog);
  assert.throws(() => paymentStepAfterEmpties(draft, preview), /Confirm the empty crates and empty bottles/);
  draft.emptiesV2.confirmedAllReturned = allReturnedConfirmationKey(draft, preview);
  const patch = paymentStepAfterEmpties(draft, preview);
  assert.equal(readSaleDraft(JSON.stringify({ ...draft, ...patch })).step, "payment");

  draft.emptiesV2.mode = "actual";
  const actual = paymentStepAfterEmpties(draft, matchSaleEmpties(draft, catalog));
  assert.deepEqual(actual, { step: "payment" });
});

test("bulk empty returns group only unambiguous exact empty-crate and empty-bottle types", () => {
  const draft = sale("goldberg", 40);
  draft.emptiesV2.mode = "exact";
  const expected = matchSaleEmpties(draft, catalog);
  const groups = bulkReturnGroups(expected, catalog);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], {
    crateTypeId: "goldberg-crate",
    crateName: "Goldberg",
    bottleType: "Goldberg bottle",
    pocketCount: 12,
    expectedCrates: 40,
    expectedBottles: 480,
  });
  assert.equal(bulkReturnGroups(expected, catalog, 41).length, 0);

  const conflictingBottle = { ...trophy, bottle_type: "Goldberg bottle" };
  const conflictingCatalog = { ...catalog, products: [goldberg, conflictingBottle, big] };
  draft.lines.push({ productId: "trophy", quantity: { crates: 12, fraction: 0, bottles: 0 } });
  const sharedBottle = matchSaleEmpties(draft, conflictingCatalog);
  assert.equal(bulkReturnGroups(sharedBottle, conflictingCatalog).length, 0);
});

test("bulk shortcut updates exact physical counts without inventing empties or losing loose ones", () => {
  assert.deepEqual(bulkReturnParts("40", "480", 12), {
    completeSets: 40,
    looseCrates: 0,
    looseBottles: 0,
  });
  const parts = { completeSets: 39, looseCrates: 1, looseBottles: 6 };
  const physical = updateBulkReturnParts(parts, "completeSets", "38", 12);
  assert.deepEqual(physical, { crates: "39", bottles: "462" });
  assert.deepEqual(bulkReturnParts(physical!.crates, physical!.bottles, 12), {
    completeSets: 38,
    looseCrates: 1,
    looseBottles: 6,
  });
  assert.equal(updateBulkReturnParts(parts, "completeSets", "-1", 12), null);
  assert.equal(updateBulkReturnParts(parts, "looseBottles", "", 12), null);
  assert.equal(bulkReturnParts("abc", "12", 12), null);
  assert.equal(bulkReturnParts("1", "6", 12)?.completeSets, 0);
});

test("quick retail path only applies to a single small loose-bottle purchase", () => {
  const single = sale("goldberg", 0);
  single.lines[0].quantity = { crates: 0, fraction: 0, bottles: 1 };
  assert.equal(isQuickRetailEmptiesSale(single), true);
  single.lines[0].quantity.bottles = 6;
  assert.equal(isQuickRetailEmptiesSale(single), true);
  single.lines[0].quantity.bottles = 7;
  assert.equal(isQuickRetailEmptiesSale(single), false);
  single.lines[0].quantity = { crates: 1, fraction: 0, bottles: 0 };
  assert.equal(isQuickRetailEmptiesSale(single), false);
  single.lines[0].quantity = { crates: 0, fraction: 1, bottles: 0 };
  assert.equal(isQuickRetailEmptiesSale(single), false);
  single.lines[0].quantity = { crates: 0, fraction: 0, bottles: 1 };
  single.lines.push({ productId: "trophy", quantity: { crates: 0, fraction: 0, bottles: 1 } });
  assert.equal(isQuickRetailEmptiesSale(single), false);
});
