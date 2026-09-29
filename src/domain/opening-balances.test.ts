import test from "node:test";
import assert from "node:assert/strict";
import {
  validateOpeningBalances,
  openingSaveError,
} from "./opening-balances.ts";
const base = {
  amount: "5000",
  businessDate: "2026-09-28",
  note: " From notebook ",
  crates: [],
  bottles: [],
};
test("opening balances accept old money, crates and bottles independently", () => {
  const result = validateOpeningBalances(
    {
      ...base,
      crates: [{ type: "10000000-0000-4000-8000-000000000001", quantity: "2" }],
      bottles: [{ type: "Trophy", quantity: "24" }],
    },
    "2026-09-29",
  );
  assert.deepEqual(result.errors, {});
  assert.equal(result.values?.amount, 5000);
  assert.equal(result.values?.note, "From notebook");
  assert.equal(result.values?.crates[0].quantity, 2);
  assert.equal(result.values?.bottles[0].quantity, 24);
  assert.ok(
    validateOpeningBalances(
      { ...base, amount: "0", bottles: [{ type: "Trophy", quantity: "6" }] },
      "2026-09-29",
    ).values,
  );
});
test("opening balances reject invalid amounts, no balances, future dates and duplicate types", () => {
  for (const amount of ["-1", "1.5", "NaN", "2147483648", ""])
    assert.ok(
      validateOpeningBalances({ ...base, amount }, "2026-09-29").errors.amount,
    );
  assert.ok(
    validateOpeningBalances({ ...base, amount: "0" }, "2026-09-29").errors
      .amount,
  );
  for (const businessDate of ["2026-02-30", "2027-01-01", ""])
    assert.ok(
      validateOpeningBalances({ ...base, businessDate }, "2026-09-29").errors
        .businessDate,
    );
  const r = validateOpeningBalances(
    {
      ...base,
      bottles: [
        { type: "Trophy", quantity: "2" },
        { type: "Trophy", quantity: "3" },
      ],
    },
    "2026-09-29",
  );
  assert.ok(r.errors["bottles.1.type"]);
});
test("opening errors protect data and lock uncertain retries without leaking database wording", () => {
  assert.equal(
    openingSaveError("22023", "opening_already_recorded").retryable,
    undefined,
  );
  assert.match(
    openingSaveError("22023", "opening_request_changed").message!,
    /already/,
  );
  assert.match(openingSaveError("42501").message!, /session/);
  for (const code of ["23505", "PGRST000", undefined]) {
    const r = openingSaveError(code, "secret_table constraint failed");
    assert.equal(r.retryable, true);
    assert.doesNotMatch(r.message!, /secret_table|constraint/);
  }
});
