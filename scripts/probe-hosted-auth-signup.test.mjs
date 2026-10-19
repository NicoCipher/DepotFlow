import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_PROJECT_REF,
  EXPECTED_DENIAL,
  verifyStagingInputs,
  testSignupDenial,
} from "./probe-hosted-auth-signup.mjs";

const stagingRef = "abcdefghijklmnopqrst";
const good = {
  url: "https://" + stagingRef + ".supabase.co",
  key: "sb_publishable_" + "x".repeat(30),
  stagingRef,
  testEmail: "qa@depotflow.test.ng",
  allowProbe: "I_ACCEPT_A_TEST_SIGNUP_ON_ISOLATED_STAGING",
};

test("production project ref is hard rejected", () => {
  assert.throws(
    () => verifyStagingInputs({ ...good, stagingRef: PRODUCTION_PROJECT_REF,
      url: "https://" + PRODUCTION_PROJECT_REF + ".supabase.co" }),
    /non-production/
  );
});
test("explicit staging-only opt-in required", () => {
  assert.throws(() => verifyStagingInputs({ ...good, allowProbe: "" }), /opt-in/);
});
test("no URL authority or origin tricks", () => {
  for (const url of [
    "https://evil.test",
    "http://" + stagingRef + ".supabase.co",
    "https://" + stagingRef + ".supabase.co.evil.test",
    "https://evil@" + stagingRef + ".supabase.co",
    "https://" + stagingRef + ".supabase.co/auth/v1/signup",
    "https://" + stagingRef + ".supabase.co?x=1",
  ]) {
    assert.throws(() => verifyStagingInputs({ ...good, url }), /branch origin/);
  }
});
test("staging inputs permit isolated manual test only", () => {
  const parsed = verifyStagingInputs(good);
  assert.equal(parsed.url, good.url);
  assert.equal(parsed.testEmail, good.testEmail);
});
test("exact hook 403 rejection is required", () => {
  assert.equal(testSignupDenial(403, { msg: EXPECTED_DENIAL }), true);
  for (const [status, body] of [
    [200, { user: { id: "created" } }],
    [400, { msg: "Email invalid" }],
    [403, { msg: "Auth signups disabled by other setting" }],
    [401, { msg: EXPECTED_DENIAL }],
  ]) {
    assert.throws(() => testSignupDenial(status, body), /HOSTED AUTH RELEASE BLOCKED/);
  }
});
