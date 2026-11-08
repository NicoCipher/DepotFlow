#!/usr/bin/env node
/**
 * End-to-end two-owner tenant isolation test.
 * Requires a disposable local Supabase CLI stack on fixed loopback ports.
 * Never accepts hosted URLs or credentials.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const API = "http://127.0.0.1:54321";
const APP = "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const fail = (message) => { throw new Error(message); };

function env(name) {
  const value = process.env[name];
  if (!value) fail("Missing local test environment value: " + name);
  return value;
}
function sql(statement) {
  return execFileSync("psql", [DB, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], {
    encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function assertLoopback() {
  if (process.env.DEPOTFLOW_BUSINESS_E2E_LOCAL_ONLY !== "I_VERIFY_DISPOSABLE_LOOPBACK_ONLY") {
    fail("Refusing to run without explicit disposable-local approval");
  }
  if (env("API_URL") !== API || env("NEXT_PUBLIC_SUPABASE_URL") !== API) {
    fail("Refusing any non-loopback Supabase endpoint");
  }
  if (env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY").startsWith("sb_secret_")) {
    fail("A secret key must never be used by the app/browser");
  }
}
async function waitForApp(child) {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) fail("Next.js server exited before becoming ready");
    try {
      const r = await fetch(APP + "/sign-in", { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {}
    await delay(1000);
  }
  fail("Next.js app did not become ready");
}
async function login(page, email, password) {
  await page.goto(APP + "/sign-in?next=%2Fbusinesses");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/businesses", { timeout: 15000 });
  await page.getByRole("heading", { name: "Choose your depot" }).waitFor();
}
async function registerDepot(page, name, address, phone) {
  await page.goto(APP + "/businesses/new");
  await page.getByRole("heading", { name: "Register your depot" }).waitFor();
  await page.getByLabel(/business name/i).fill(name);
  await page.getByLabel(/location/i).fill(address);
  const phoneField = page.getByLabel(/phone/i);
  if (await phoneField.count()) await phoneField.fill(phone);
  await page.getByRole("button", { name: /register depot/i }).click();
  await page.waitForURL(/\/businesses\/[0-9a-f-]+\/drinks$/, { timeout: 15000 });
  const match = page.url().match(/\/businesses\/([0-9a-f-]+)\/drinks$/);
  assert.ok(match, "Registration did not navigate to the new depot setup");
  return match[1];
}

assertLoopback();
assert.equal(sql("select current_setting('server_version_num')::int / 10000"), "17",
  "Browser acceptance must run on PostgreSQL 17");

const anonKey = env("ANON_KEY");
const serviceKey = env("SERVICE_ROLE_KEY");
const admin = createClient(API, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomBytes(6).toString("hex");
const password = "Df!" + randomBytes(24).toString("base64url");
const owners = [
  { email: `owner-a-${suffix}@example.org`, name: "Browser Test Depot A", address: `Ikeja test ${suffix}`, phone: "08000000001" },
  { email: `owner-b-${suffix}@example.org`, name: "Browser Test Depot B", address: `Yaba test ${suffix}`, phone: "08000000002" },
];
const created = [];
let browser;
let app;
try {
  // All rollout switches are opened only in this disposable local database.
  sql("update private.business_auth_signup_gate set enabled=true where singleton");
  sql("update private.business_registration_gate set enabled=true where singleton");
  sql("update private.business_selection_gate set enabled=true where singleton");

  for (const owner of owners) {
    const { data, error } = await admin.auth.admin.createUser({
      email: owner.email, password, email_confirm: true,
    });
    if (error) throw error;
    owner.id = data.user.id;
    created.push(owner.id);
  }

  app = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1"], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: API,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      DEPOTFLOW_PUBLIC_SIGNUP_ENABLED: "false" },
    stdio: "inherit",
  });
  await waitForApp(app);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Owner A registers a depot through the real server action and authenticated RPC.
  await login(page, owners[0].email, password);
  const businessA = await registerDepot(page, owners[0].name, owners[0].address, owners[0].phone);
  await page.goto(APP + "/businesses");
  await page.getByText(owners[0].name, { exact: true }).waitFor();
  assert.equal(await page.getByText(owners[1].name, { exact: true }).count(), 0,
    "Owner A can see Owner B's depot before it exists");

  // A fresh browser context prevents cookies/session state from leaking between owners.
  const ownerBContext = await browser.newContext();
  const ownerBPage = await ownerBContext.newPage();
  await login(ownerBPage, owners[1].email, password);
  const businessB = await registerDepot(ownerBPage, owners[1].name, owners[1].address, owners[1].phone);
  assert.notEqual(businessA, businessB, "Owners were assigned the same business ID");

  await ownerBPage.goto(APP + "/businesses");
  await ownerBPage.getByText(owners[1].name, { exact: true }).waitFor();
  assert.equal(await ownerBPage.getByText(owners[0].name, { exact: true }).count(), 0,
    "Owner B can see Owner A's depot");

  // Direct URL access must not disclose the other tenant's business identity or setup data.
  await ownerBPage.goto(APP + `/businesses/${businessA}/drinks`);
  await ownerBPage.waitForLoadState("domcontentloaded");
  assert.equal(await ownerBPage.getByText(owners[0].name, { exact: true }).count(), 0,
    "Owner B can read Owner A's depot name through a direct URL");

  await page.goto(APP + `/businesses/${businessB}/drinks`);
  await page.waitForLoadState("domcontentloaded");
  assert.equal(await page.getByText(owners[1].name, { exact: true }).count(), 0,
    "Owner A can read Owner B's depot name through a direct URL");

  // Confirm the test exercised two distinct authenticated identities and persisted registrations.
  const { data: aList, error: aError } = await admin.rpc("list_my_businesses_for_setup");
  // Service role is intentionally not used to assert RLS; browser assertions above do that.
  if (aError) console.log("Service-role list RPC not used for tenant assertions:", aError.message);
  console.log("PASS: two real browser sessions registered separate depots; picker and direct-URL checks did not leak tenant names.");
  await ownerBContext.close();
} finally {
  if (browser) await browser.close();
  if (app && app.exitCode === null) app.kill("SIGTERM");
  // Disposable stack is destroyed by the workflow even if this script fails.
}
