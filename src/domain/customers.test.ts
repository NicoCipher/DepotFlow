import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customerSearchFilter,
  emptyCustomer,
  formatEmptiesOwed,
  isCustomerId,
  normalizePhone,
  sameCustomerDetails,
  validateCustomer,
} from "./customers.ts";
import { ownerAuthorized } from "./authorization.ts";

test("normalizes customer details without discarding optional information", () => {
  const result = validateCustomer({
    name: "  Ada   Okafor ",
    phone: "0803 123 4567",
    business_name: " Ada Shop ",
    address: " 12 Market Road\nLagos ",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "Ada Okafor",
    phone: "+2348031234567",
    business_name: "Ada Shop",
    address: "12 Market Road\nLagos",
  });
  assert.equal(normalizePhone("+234 (803) 123-4567"), "+2348031234567");
  assert.equal(normalizePhone("2348031234567"), "+2348031234567");
});
test("requires name and phone and validates length and malformed input", () => {
  assert.deepEqual(Object.keys(validateCustomer(emptyCustomer).errors), [
    "name",
    "phone",
  ]);
  for (const phone of [
    "phone",
    "123",
    "++2348031234567",
    "0803/1234567",
    "1".repeat(16),
  ]) {
    assert.equal(
      validateCustomer({ ...emptyCustomer, name: "Ada", phone }).valid,
      false,
    );
  }
  const result = validateCustomer({
    name: "a".repeat(121),
    phone: "08031234567",
    business_name: "b".repeat(161),
    address: "c".repeat(501),
  });
  assert.deepEqual(Object.keys(result.errors), [
    "name",
    "business_name",
    "address",
  ]);
  assert.equal(
    validateCustomer({ ...emptyCustomer, name: "Ada", phone: "08031234567" })
      .data.business_name,
    null,
  );
});
test("owner access fails closed for absent identity, false results, and errors", () => {
  assert.equal(ownerAuthorized("owner-id", true, null), true);
  assert.equal(ownerAuthorized(undefined, true, null), false);
  assert.equal(ownerAuthorized("non-owner", false, null), false);
  assert.equal(ownerAuthorized("owner-id", true, new Error("offline")), false);
  for (const result of [null, undefined, "true", 1])
    assert.equal(ownerAuthorized("owner-id", result, null), false);
});
test("search normalizes Nigerian phones and quotes filter syntax literally", () => {
  assert.equal(
    customerSearchFilter("  Ada   Okafor "),
    'name.ilike."%Ada Okafor%",phone.ilike."%AdaOkafor%"',
  );
  assert.ok(
    customerSearchFilter("0803 123 4567").includes(
      'phone.ilike."%+2348031234567%"',
    ),
  );
  assert.ok(customerSearchFilter("0803").includes('phone.ilike."%+234803%"'));
  const filter = customerSearchFilter('Ada",id.neq.x');
  assert.ok(filter.startsWith('name.ilike."%Ada\\",id.neq.x%"'));
  assert.ok(customerSearchFilter("%_*").includes("\\\\%\\\\_\\\\*"));
});
test("retry recognition requires all details to match and validates form IDs", () => {
  const data = validateCustomer({
    ...emptyCustomer,
    name: "Ada",
    phone: "08031234567",
  }).data;
  assert.equal(sameCustomerDetails(data, { ...data }), true);
  assert.equal(
    sameCustomerDetails(data, { ...data, address: "New address" }),
    false,
  );
  assert.equal(sameCustomerDetails(data, { ...data, name: "Other" }), false);
  assert.equal(isCustomerId("not-an-id"), false);
  assert.equal(isCustomerId("10000000-0000-4000-8000-000000000001"), true);
});
test("empties owed combines independent crate and bottle counts for scanning", () => {
  assert.equal(formatEmptiesOwed(0, 0), "None");
  assert.equal(formatEmptiesOwed(1, 0), "1 crate");
  assert.equal(formatEmptiesOwed(3, 0), "3 crates");
  assert.equal(formatEmptiesOwed(0, 1), "1 bottle");
  assert.equal(formatEmptiesOwed(0, 12), "12 bottles");
  assert.equal(formatEmptiesOwed(2, 5), "2 crates + 5 bottles");
});
