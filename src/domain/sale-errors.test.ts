import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSaleSessionExpired,
  saleReviewMissingUserResponse,
  saleReviewOwnerAccessResponse,
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

test("removed shop drink is a definitive rejected sale, not an uncertain save", () => {
  assert.match(
    safeDatabaseSaleErrorMessage("22023", "This drink was removed from the shop; restore it before selling"),
    /removed from the shop.*Go back to Drinks/,
  );
});

test("review endpoint keeps checkout retryable when Supabase auth is temporarily unavailable", () => {
  for (const authError of [
    { status: 503, name: "AuthRetryableFetchError", message: "Service unavailable" },
    { status: 502, name: "AuthRetryableFetchError", message: "Fetch failed" },
    { name: "TypeError", message: "fetch failed" },
    { status: 500, message: "Gateway failure" },
  ]) {
    const result = saleReviewMissingUserResponse(authError);
    assert.equal(result.code, "network_error");
    assert.equal(result.status, 503);
    assert.match(result.error, /Try again/);
    assert.doesNotMatch(result.error, /Sign in again/);
  }
});

test("review endpoint still requires sign-in when session really expired", () => {
  for (const authError of [
    null,
    { status: 401, name: "AuthApiError", message: "JWT expired" },
    { status: 403, name: "AuthApiError", message: "Forbidden" },
    { name: "AuthSessionMissingError", message: "Auth session missing" },
    { name: "AuthApiError", message: "Refresh token invalid" },
  ]) {
    const result = saleReviewMissingUserResponse(authError);
    assert.equal(result.code, "session_expired");
    assert.equal(result.status, 401);
    assert.match(result.error, /Sign in again/);
  }
});

test("owner RPC transient error is retryable, not an access revocation", () => {
  for (const ownerError of [
    { code: "PGRST000", message: "temporary connection failure" },
    { status: 503, message: "Service unavailable" },
    { status: 502, message: "Bad gateway" },
    { code: "57014", message: "statement timeout" },
  ]) {
    const result = saleReviewOwnerAccessResponse(ownerError);
    assert.deepEqual(result, {
      error: "Couldn’t connect. Your sale is still here. Try again.",
      code: "network_error",
      status: 503,
    });
  }
});

test("authenticated but definitively non-owner still cannot review sales", () => {
  assert.deepEqual(saleReviewOwnerAccessResponse(null), {
    error: "Shop owner access is required.",
    code: "access_denied",
    status: 403,
  });
});
