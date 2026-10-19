#!/usr/bin/env node
/**
 * Real local GoTrue /auth/v1/signup integration test.
 *
 * Fail-closed safety contract: ONLY fixed 127.0.0.1 loopback ports, no hosted
 * Supabase URLs or production project refs. Uses a disposable Supabase CLI
 * stack, not an online project, and a copied exact staged migration.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const LOOPBACK_API = "http://127.0.0.1:54321";
const LOOPBACK_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const HOOK = "private.depotflow_before_user_created(jsonb)";
const DENIAL = "Account registration is not available.";

function requireLocalEnvironment() {
  if (process.env.DEPOTFLOW_AUTH_LOCAL_ONLY !== "I_VERIFY_DISPOSABLE_LOOPBACK_ONLY") {
    throw Error("Refusing to test signup without explicit local-only approval");
  }
  if (process.env.DEPOTFLOW_LOCAL_SUPABASE_API_URL !== LOOPBACK_API) {
    throw Error("Refusing non-loopback or unexpected Auth API endpoint");
  }
  const key = process.env.DEPOTFLOW_LOCAL_SUPABASE_ANON_KEY;
  if (typeof key !== "string" || key.length < 24) {
    throw Error("Disposable local anon key is unavailable");
  }
  return key;
}

function sql(statement) {
  return execFileSync("psql", [LOOPBACK_DB, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], {
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function signup(key, email, password) {
  const r = await fetch(LOOPBACK_API + "/auth/v1/signup", {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

function assertDenied(response, label) {
  const msg = [response.data?.msg, response.data?.message, response.data?.error,
    response.data?.error_description].filter(x => typeof x === "string").join(" ");
  assert.equal(response.status, 403, label + ": expected direct GoTrue HTTP 403, got " +
    response.status + " / " + msg.slice(0, 150));
  assert.ok(msg.includes(DENIAL), label + ": wrong denial reason: " + msg.slice(0, 150));
  assert.equal(response.data?.user, undefined, label + ": user returned on denied signup");
  assert.equal(response.data?.access_token, undefined, label + ": session returned on denied signup");
}

function userCount(email) {
  if (!/^depotflow-auth-ci-[a-f0-9]{16}@example\.org$/.test(email)) {
    throw Error("Unsafe test email");
  }
  return Number(sql("select count(*) from auth.users where email='" + email + "'"));
}

export async function run() {
  const key = requireLocalEnvironment();
  assert.equal(sql("select current_setting('server_version_num')::int / 10000"), "17");
  assert.equal(sql("select enabled from private.business_auth_signup_gate where singleton"), "f");
  assert.equal(sql("select has_function_privilege('supabase_auth_admin','" + HOOK + "','EXECUTE')"), "t");
  assert.equal(sql("select has_function_privilege('anon','" + HOOK + "','EXECUTE')"), "f");
  assert.equal(sql("select has_function_privilege('authenticated','" + HOOK + "','EXECUTE')"), "f");

  const prefix = "depotflow-auth-ci-";
  const email1 = prefix + randomBytes(8).toString("hex") + "@example.org";
  const email2 = prefix + randomBytes(8).toString("hex") + "@example.org";
  const email3 = prefix + randomBytes(8).toString("hex") + "@example.org";
  const password = "Df!" + randomBytes(24).toString("base64url");
  for (const e of [email1,email2,email3]) assert.equal(userCount(e),0);

  // 1. Not app's signup page: direct anonymous GoTrue API must invoke hook.
  assertDenied(await signup(key,email1,password),"Disabled signup (direct Auth bypass)");
  assert.equal(userCount(email1),0,"Denied email was created despite hook rejection");
  console.log("PASS local direct GoTrue signup denied by DB hook (gate OFF, no user)");

  // 2. Allow only within this disposable database. Email confirmation must
  // remain mandatory; no usable session in the signup response.
  sql("update private.business_auth_signup_gate set enabled=true where singleton");
  assert.equal(sql("select enabled from private.business_auth_signup_gate where singleton"),"t");
  const accepted = await signup(key,email2,password);
  assert.ok(accepted.status === 200 || accepted.status === 201,
    "Gate ON failed to create test user, HTTP " + accepted.status +
    " / " + JSON.stringify(accepted.data).slice(0,200));
  // Raw GoTrue REST /signup returns a user object at the TOP LEVEL when
  // email confirmations are enabled; supabase-js wraps it under data.user.
  const createdUser = accepted.data?.user ??
    (accepted.data?.id && accepted.data?.email ? accepted.data : null);
  assert.ok(createdUser?.id,"Allowed raw GoTrue signup lacks user identity");
  assert.equal(createdUser?.email,email2,"Unexpected signup user email");
  assert.equal(accepted.data?.session ?? null,null,"Unconfirmed signup got a session");
  assert.equal(accepted.data?.access_token ?? null,null,"Unconfirmed signup got access token");
  assert.equal(userCount(email2),1,"Allowed signup not persisted once");
  assert.equal(sql("select email_confirmed_at is null from auth.users where email='" + email2 + "'"),"t");
  const login = await fetch(LOOPBACK_API+"/auth/v1/token?grant_type=password",{
    method:"POST",headers:{apikey:key,"Content-Type":"application/json"},
    body:JSON.stringify({email:email2,password}),redirect:"error",
    signal:AbortSignal.timeout(15000),
  });
  assert.notEqual(login.status,200,"Unconfirmed test user could sign in");
  console.log("PASS local gate ON creates one unconfirmed user without session");

  // 3. Disabling again must immediately reject another direct Auth request.
  sql("update private.business_auth_signup_gate set enabled=false where singleton");
  assertDenied(await signup(key,email3,password),"Re-disabled signup");
  assert.equal(userCount(email3),0,"Re-disabled gate created an Auth user");
  assert.equal(userCount(email2),1,"Closing gate removed existing allowed user");
  console.log("PASS re-disabled local gate blocks new users and preserves prior user");
  console.log("PASS local Auth hook E2E, direct signup bypass blocked; hosted configuration remains UNVERIFIED.");
}

if (process.argv[1]?.endsWith("/test-local-gotrue-signup.mjs")) {
  run().catch(err => {
    console.error("LOCAL AUTH INTEGRATION FAILED:",err?.message??String(err));
    process.exitCode=1;
  });
}
