import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSaleSessionExpired,
  saleSessionExpiredMessage,
  safeCaughtSaleErrorMessage,
  safeDatabaseSaleErrorMessage,
  saleUnexpectedErrorMessage,
} from "./sale-errors.ts";

test("missing or rejected auth session is treated as expired", () => {
  assert.equal(isSaleSessionExpired(false, null), true);
  assert.equal(
    isSaleSessionExpired(false, { status: 401, name: "AuthApiError" }),
    true,
  );
  assert.equal(
    isSaleSessionExpired(false, {
      name: "AuthSessionMissingError",
      message: "Auth session missing",
    }),
    true,
  );
  assert.match(saleSessionExpiredMessage, /Sign in again/);
});

test("network auth failure is not mislabeled as an expired session", () => {
  assert.equal(
    isSaleSessionExpired(false, {
      name: "TypeError",
      message: "fetch failed",
    }),
    false,
  );
  assert.equal(isSaleSessionExpired(true, { status: 401 }), false);
});

test("unexpected server and database details never reach the sale UI", () => {
  assert.equal(
    safeCaughtSaleErrorMessage(
      new Error('relation "private.stock" does not exist'),
    ),
    saleUnexpectedErrorMessage,
  );
  assert.equal(
    safeDatabaseSaleErrorMessage("XX000", "internal cache lookup failed"),
    saleUnexpectedErrorMessage,
  );
  assert.equal(
    safeDatabaseSaleErrorMessage(
      "22023",
      'invalid input syntax for type uuid: "oops"',
    ),
    saleUnexpectedErrorMessage,
  );
});

test("known business-rule failures keep useful plain-language recovery", () => {
  assert.equal(
    safeCaughtSaleErrorMessage(
      new Error("Only 1 crate + 6 bottles available now. Change the quantity."),
    ),
    "Only 1 crate + 6 bottles available now. Change the quantity.",
  );
  assert.equal(
    safeDatabaseSaleErrorMessage("22023", "Not enough stock. Review the sale."),
    "Stock changed while saving. Review the quantity and try again.",
  );
  assert.equal(
    safeDatabaseSaleErrorMessage(
      "22023",
      "Choose an exact crate type for this drink before saving.",
    ),
    "This drink’s physical crate setup is incomplete. Fix the drink setup before saving.",
  );
});
