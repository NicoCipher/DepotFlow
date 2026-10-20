import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicSignupConfig } from "./public-signup.ts";

test("public signup is default off without an explicit switch and trusted origin", () => {
  assert.deepEqual(resolvePublicSignupConfig(undefined, "https://example.com"), {
    enabled: false, emailRedirectTo: null,
  });
  assert.equal(resolvePublicSignupConfig("true", undefined).enabled, false);
  assert.equal(resolvePublicSignupConfig("TRUE", "https://example.com").enabled, false);
});

test("trusted HTTPS origin produces only the fixed multi-business sign-in return", () => {
  const config = resolvePublicSignupConfig("true", "https://depotflow.example");
  assert.equal(config.enabled, true);
  assert.equal(config.emailRedirectTo, "https://depotflow.example/sign-in?next=%2Fbusinesses");
});

test("localhost can be used for isolated email flow tests", () => {
  assert.equal(
    resolvePublicSignupConfig("true", "http://localhost:3000").emailRedirectTo,
    "http://localhost:3000/sign-in?next=%2Fbusinesses",
  );
});

test("unsafe, forged or malformed origins fail closed", () => {
  for (const value of [
    "http://example.com",
    "https://example.com/unauthorized",
    "https://example.com?next=https://evil.example",
    "https://example.com#fragment",
    "https://user:pass@example.com",
    "javascript:alert(1)",
    "not-a-url",
    "https://example.com\\@evil.example",
  ]) {
    assert.equal(resolvePublicSignupConfig("true", value).enabled, false, value);
  }
});
