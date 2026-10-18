import assert from "node:assert/strict";
import test from "node:test";
import {
  canPresentOwnerSignoff,
  openingChecklist,
  type OpeningReadinessSnapshot,
} from "./opening-readiness.ts";

const ready: OpeningReadinessSnapshot = {
  businessId: "business-a",
  businessStatus: "setup",
  profile: { name: "Sample Depot A", address: "Yaba", phone: "" },
  configured: {
    activeDrinks: 3, crateTypes: 2, returnableBottleTypes: 2, activeCustomers: 5,
  },
  physicalOpening: {
    missingDrinks: 0, missingCrates: 0, missingBottleTypes: 0,
    missingDrinkIds: [], missingCrateTypeIds: [],
    missingBottleTypeLabels: [], unconfiguredReturnables: 0,
    changedAfterOpening: 0,
  },
  customerOpening: {
    customersWithOpening: 2, customersWithoutOpening: 3,
    historicalDebtNaira: 45000, refundableDepositsHeldNaira: 10000,
    customerCratesOwed: 2, customerBottlesOwed: 7,
    accountMismatches: 0,
  },
  operationalEventsBeforeCutover: 0,
  technicalChecklistComplete: true,
  customerHistoryAttestationRequired: true,
  canActivate: false,
};

test("opening review is not an activation permission", () => {
  assert.equal(canPresentOwnerSignoff(ready), true);
  assert.equal(ready.canActivate, false);
  const tasks = openingChecklist(ready);
  assert.equal(tasks.find((x) => x.id === "customer-history")?.status, "confirm");
  assert.equal(tasks.find((x) => x.id === "drinks")?.status, "confirm");
  assert.equal(tasks.find((x) => x.id === "stock")?.status, "done");
});

test("missing physical count cannot be treated as a confirmed zero", () => {
  const partial: OpeningReadinessSnapshot = {
    ...ready,
    technicalChecklistComplete: false,
    physicalOpening: { ...ready.physicalOpening, missingCrates: 1, missingBottleTypes: 1 },
  };
  assert.equal(canPresentOwnerSignoff(partial), false);
  assert.match(openingChecklist(partial).find((x) => x.id === "crates")!.description, /Count 1/);
});

test("same-quantity recount blocks owner sign-off presentation", () => {
  const changed: OpeningReadinessSnapshot = {
    ...ready,
    technicalChecklistComplete: false,
    physicalOpening: { ...ready.physicalOpening, changedAfterOpening: 1 },
  };
  assert.equal(canPresentOwnerSignoff(changed), false);
  assert.equal(openingChecklist(changed).find((x) => x.id === "stock")?.status, "action");
});

test("bad customer financial ledger is visibly blocked", () => {
  const changed: OpeningReadinessSnapshot = {
    ...ready,
    technicalChecklistComplete: false,
    customerOpening: { ...ready.customerOpening, accountMismatches: 2 },
  };
  assert.equal(canPresentOwnerSignoff(changed), false);
  assert.match(openingChecklist(changed).find((x) => x.id === "accounts")!.description, /2 customer/);
});

test("active depot cannot sign setup records even if numeric data looks complete", () => {
  assert.equal(canPresentOwnerSignoff({ ...ready, businessStatus: "active" }), false);
});

test("customer debts and refundable deposits are separate", () => {
  assert.equal(ready.customerOpening.historicalDebtNaira, 45000);
  assert.equal(ready.customerOpening.refundableDepositsHeldNaira, 10000);
  assert.equal(ready.customerOpening.customersWithoutOpening, 3);
});
