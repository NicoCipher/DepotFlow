import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyProduct,
  validateProduct,
  productSearchFilter,
  normalizeProductSearch,
  sameProductDetails,
  validImageUrl,
  productValues,
  isProductId,
} from "./products.ts";

const valid = {
  ...emptyProduct,
  name: "  Guinness   Big ",
  bottles_per_crate: "12",
  full_crate_price: "12500",
  bottles_returnable: "true",
  crate_type_id: "50000000-0000-4000-8000-000000000001",
  bottle_type: " Guinness bottle ",
};
test("normalizes text while keeping optional fields and prices null", () => {
  const result = validateProduct(valid);
  assert.equal(result.valid, true);
  assert.equal(result.data.name, "Guinness Big");
  assert.equal(
    result.data.crate_type_id,
    "50000000-0000-4000-8000-000000000001",
  );
  assert.equal(result.data.size, null);
  assert.equal(result.data.half_crate_price, null);
  assert.equal(result.data.quarter_crate_price, null);
  assert.equal(result.data.bottle_price, null);
  assert.equal(result.data.full_crate_price, 12500);
});
test("prices are explicit whole naira in 50 increments, including zero", () => {
  for (const field of [
    "full_crate_price",
    "half_crate_price",
    "quarter_crate_price",
    "bottle_price",
  ] as const) {
    for (const price of [
      "1",
      "12525",
      "50.0",
      "50.5",
      "-50",
      "1e3",
      "NaN",
      "Infinity",
      "2147483650",
      "12,500",
    ]) {
      assert.ok(
        validateProduct({ ...valid, [field]: price }).errors[field],
        `${field}: ${price}`,
      );
    }
    for (const price of ["0", "50", "12500", "2147483600"])
      assert.equal(
        validateProduct({ ...valid, [field]: price }).errors[field],
        undefined,
      );
  }
  assert.ok(
    validateProduct({ ...valid, full_crate_price: "" }).errors.full_crate_price,
  );
  assert.equal(
    validateProduct({ ...valid, half_crate_price: "  " }).data.half_crate_price,
    null,
  );
  assert.equal(
    validateProduct({ ...valid, half_crate_price: "0" }).data.half_crate_price,
    0,
  );
});
test("bottles per crate must be a positive PostgreSQL whole number", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "12.0",
    "1e2",
    "2147483648",
    "abc",
  ])
    assert.ok(
      validateProduct({ ...valid, bottles_per_crate: value }).errors
        .bottles_per_crate,
    );
  for (const value of ["1", "12", "24", "2147483647"])
    assert.equal(
      validateProduct({ ...valid, bottles_per_crate: value }).errors
        .bottles_per_crate,
      undefined,
    );
});
test("returnability is explicit and returnable bottles require their own type", () => {
  assert.ok(
    validateProduct({ ...valid, bottles_returnable: "" }).errors
      .bottles_returnable,
  );
  assert.ok(validateProduct({ ...valid, bottle_type: " " }).errors.bottle_type);
  assert.ok(
    validateProduct({ ...valid, crate_type_id: " " }).errors.crate_type_id,
  );
  assert.equal(
    validateProduct({ ...valid, bottles_returnable: "false", bottle_type: "" })
      .valid,
    true,
  );
  assert.equal(validateProduct({ ...valid, bottle_type: "" }).valid, false);
});
test("text limits and image protocols are checked", () => {
  for (const [field, length] of [
    ["name", 120],
    ["size", 80],
    ["crate_type_id", 120],
    ["bottle_type", 120],
    ["image_url", 2048],
  ] as const) {
    assert.ok(
      validateProduct({ ...valid, [field]: "a".repeat(length + 1) }).errors[
        field
      ],
    );
  }
  assert.ok(validateProduct({ ...valid, name: "  " }).errors.name);
  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "/image.png",
    "ftp://example.com/p.png",
    "https://user:password@example.com/a",
  ])
    assert.equal(validImageUrl(url), false);
  assert.equal(validImageUrl("https://example.com/drink.png"), true);
  assert.equal(validImageUrl("http://example.com/drink.jpg"), true);
});
test("search normalizes whitespace and quotes reserved filter characters", () => {
  assert.equal(normalizeProductSearch("  Guinness   Big  "), "Guinness Big");
  assert.equal(
    productSearchFilter("  60 cl  "),
    'name.ilike."%60 cl%",size.ilike."%60 cl%"',
  );
  assert.equal(
    productSearchFilter('x",id.neq.y'),
    'name.ilike."%x\\",id.neq.y%",size.ilike."%x\\",id.neq.y%"',
  );
  assert.ok(productSearchFilter("%_").includes("\\\\%\\\\_"));
});
test("duplicate retry comparison checks every saved detail without assuming unique names", () => {
  const data = validateProduct(valid).data;
  assert.equal(sameProductDetails(data, { ...data }), true);
  for (const field of Object.keys(data) as (keyof typeof data)[]) {
    const changed = {
      ...data,
      [field]:
        typeof data[field] === "boolean"
          ? false
          : typeof data[field] === "number"
            ? 50
            : "different",
    };
    assert.equal(sameProductDetails(data, changed), false, field);
  }
  const values = productValues({
    ...data,
    crate_type: null,
    empty_family: null,
    id: "10000000-0000-4000-8000-000000000001",
    created_at: "2026-09-13",
  });
  assert.equal(values.bottles_returnable, "true");
  assert.equal(values.half_crate_price, "");
  assert.equal(isProductId("10000000-0000-4000-8000-000000000001"), true);
  assert.equal(isProductId("bad-id"), false);
});
