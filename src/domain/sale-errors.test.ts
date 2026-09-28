import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSaleSessionExpired,
  safeSaleDatabaseMessage,
  safeSaleDomainMessage,
  saleUnexpectedMessage,
  saleSessionExpiredMessage,
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


test("known sale business errors remain actionable", () => {
  assert.equal(
    safeSaleDatabaseMessage({
      code: "22023",
      message: "Not enough stock. Review the sale.",
    }),
    "Stock changed before the sale finished. Review the quantities and try again.",
  );
  assert.equal(
    safeSaleDatabaseMessage({
      code: "22023",
      message: "Choose an exact crate type for this drink before saving.",
    }),
    "This drink’s physical crate setup is incomplete. Finish the drink setup before saving.",
  );
  assert.equal(
    safeSaleDomainMessage(
      new Error("Only 1 crate + 6 bottles available now. Change the quantity."),
    ),
    "Only 1 crate + 6 bottles available now. Change the quantity.",
  );
});

test("unknown database and thrown errors are never user-facing", () => {
  assert.equal(
    safeSaleDatabaseMessage({
      code: "XX000",
      message: "relation private.secret_table does not exist",
    }),
    null,
  );
  assert.equal(
    safeSaleDatabaseMessage({
      code: "22023",
      message: "internal function foo_bar failed at line 91",
    }),
    null,
  );
  assert.equal(
    safeSaleDomainMessage(
      new Error("ECONNRESET while calling internal service"),
    ),
    null,
  );
  assert.match(saleUnexpectedMessage, /sale is still here/i);
});
