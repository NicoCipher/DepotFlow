import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSaleSessionExpired,
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
