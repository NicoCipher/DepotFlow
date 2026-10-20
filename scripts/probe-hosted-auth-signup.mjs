#!/usr/bin/env node
/**
 * Hosted Supabase Auth bypass smoke test for an isolated staging BRANCH only.
 *
 * This intentionally submits a direct GoTrue /auth/v1/signup request, without
 * going through DepotFlow. It may create a real STAGING auth user if the gate
 * is broken. Never point it at production or use customer email addresses.
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const PRODUCTION_PROJECT_REF = "coyivbklakhilpcqqrzg";
export const EXPECTED_DENIAL = "Account registration is not available.";

export function verifyStagingInputs(input) {
  const { url, key, stagingRef, testEmail, allowProbe } = input;
  if (allowProbe !== "I_ACCEPT_A_TEST_SIGNUP_ON_ISOLATED_STAGING") {
    throw new Error("An explicit disposable staging signup probe opt-in is required.");
  }
  if (!/^[a-z0-9]{20}$/.test(stagingRef || "") ||
      stagingRef === PRODUCTION_PROJECT_REF) {
    throw new Error("Provide a valid, non-production Supabase branch project ref.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" ||
      parsed.hostname !== stagingRef + ".supabase.co" ||
      parsed.port || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Staging URL must be the exact dedicated Supabase branch origin.");
  }
  if (!key || typeof key !== "string" || key.length < 24) {
    throw new Error("Provide the staging branch publishable/anon key securely.");
  }
  const emailParts = (testEmail || "").trim().split("@");
  if (emailParts.length !== 2 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(emailParts[0]) ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailParts[1]) ||
      /^(?:example\.(?:com|org|net)|invalid|localhost)$/i.test(emailParts[1])) {
    throw new Error("Use a real, controlled TEST email inbox on the staging branch.");
  }
  return { url: parsed.origin, key, testEmail: emailParts.join("@") };
}

export function testSignupDenial(status, body) {
  const message = body && typeof body === "object"
    ? [body.msg, body.message, body.error, body.error_description]
        .filter(x => typeof x === "string").join(" ")
    : "";
  if (status !== 403 || !message.includes(EXPECTED_DENIAL)) {
    throw new Error(
      "HOSTED AUTH RELEASE BLOCKED: direct GoTrue signup did not return the " +
      "expected Before User Created policy rejection. " +
      "A staging test user MAY have been created; inspect Auth > Users."
    );
  }
  return true;
}

export async function run() {
  const cfg = verifyStagingInputs({
    url: process.env.DEPOTFLOW_STAGING_SUPABASE_URL,
    key: process.env.DEPOTFLOW_STAGING_SUPABASE_PUBLISHABLE_KEY,
    stagingRef: process.env.DEPOTFLOW_STAGING_PROJECT_REF,
    testEmail: process.env.DEPOTFLOW_STAGING_TEST_EMAIL,
    allowProbe: process.env.DEPOTFLOW_STAGING_AUTH_PROBE_APPROVAL,
  });
  const password = randomBytes(28).toString("base64url") + "aZ9!";
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), 12000);
  try {
    const result = await fetch(cfg.url + "/auth/v1/signup", {
      method: "POST",
      headers: {
        "apikey": cfg.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: cfg.testEmail, password }),
      signal: controller.signal,
      redirect: "error",
    });
    const body = await result.json().catch(() => ({}));
    testSignupDenial(result.status, body);
    console.log("PASS: isolated staging GoTrue signup denied with expected hook 403.");
  } finally {
    clearTimeout(abort);
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  run().catch(err => {
    console.error(err instanceof Error ? err.message : "Auth probe failed.");
    process.exitCode = 2;
  });
}
