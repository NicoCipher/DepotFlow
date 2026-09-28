import assert from "node:assert/strict";
import { test } from "node:test";
import { safeSignInReturnPath } from "./auth-navigation.ts";

test("sign-in return path accepts only the two sale routes", () => {
  assert.equal(safeSignInReturnPath("/record-sale"), "/record-sale");
  assert.equal(
    safeSignInReturnPath("/record-sale/paused"),
    "/record-sale/paused",
  );
});

test("sign-in return path rejects external and unrelated destinations", () => {
  for (const value of [
    "https://example.com",
    "//example.com",
    "/customers",
    "/record-sale?bad=1",
    "",
    null,
    undefined,
  ])
    assert.equal(safeSignInReturnPath(value), "/");
});
