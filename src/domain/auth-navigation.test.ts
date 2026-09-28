import assert from "node:assert/strict";
import { test } from "node:test";
import { safeSignInReturnPath } from "./auth-navigation.ts";

test("sign-in return path allows only known internal sale pages", () => {
  assert.equal(safeSignInReturnPath("/record-sale"), "/record-sale");
  assert.equal(
    safeSignInReturnPath("/record-sale/paused"),
    "/record-sale/paused",
  );
});

test("sign-in return path rejects external and unexpected destinations", () => {
  for (const value of [
    "https://example.com",
    "//example.com",
    "/customers",
    "/record-sale?x=1",
    "",
    null,
  ])
    assert.equal(safeSignInReturnPath(value), "/");
});
