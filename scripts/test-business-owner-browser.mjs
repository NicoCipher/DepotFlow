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
  await page.getByRole("button", { name: "Create depot" }).click();
  await page.waitForURL(/\/businesses\/[0-9a-f-]+\/drinks$/, { timeout: 15000 });
  const match = page.url().match(/\/businesses\/([0-9a-f-]+)\/drinks$/);
  assert.ok(match, "Registration did not navigate to the new depot setup");
  return match[1];
}

assertLoopback();
assert.equal(sql("select current_setting('server_version_num')::int / 10000"), "17",
  "Browser acceptance must run on PostgreSQL 17");

const serviceKey = env("SERVICE_ROLE_KEY");
const admin = createClient(API, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomBytes(6).toString("hex");
const password = "Df!" + randomBytes(24).toString("base64url");
const owners = [
  { email: `owner-a-${suffix}@example.org`, name: "Browser Test Depot A", address: `Ikeja test ${suffix}`, phone: "08000000001" },
  { email: `owner-b-${suffix}@example.org`, name: "Browser Test Depot B", address: `Yaba test ${suffix}`, phone: "08000000002" },
];
let browser;
let app;
try {
  // All rollout switches are opened only in this disposable local database.
  sql("update private.business_auth_signup_gate set enabled=true where singleton");
  sql("update private.business_registration_gate set enabled=true where singleton");
  sql("update private.business_selection_gate set enabled=true where singleton");
  // Bootstrap the audited legacy write-scope anchor required by the tenant
  // sale RPC. This is the same reviewed backfill/FK-validation sequence used
  // by the rollback-only PostgreSQL sales test, confined to this disposable DB.
  const legacyEmail = `legacy-${suffix}@example.org`;
  const legacyUser = await admin.auth.admin.createUser({
    email: legacyEmail, password, email_confirm: true,
  });
  if (legacyUser.error) throw legacyUser.error;
  const legacyCustomerId = randomUUID();
  sql(`insert into private.shop_owner(user_id) values ('${legacyUser.data.user.id}');
    select private.link_legacy_shop_business();
    insert into public.customers(id,name,phone)
      values ('${legacyCustomerId}','Legacy E2E fixture','08000000003');
    select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
    do $validate$
    declare r record; n int:=0;
    begin
      for r in
        select ns.nspname s,c.relname t,k.conname
        from pg_constraint k
        join pg_class c on c.oid=k.conrelid
        join pg_namespace ns on ns.oid=c.relnamespace
        join private.legacy_scope_tables() tab
          on tab.schema_name=ns.nspname and tab.table_name=c.relname
        where k.contype='f' and left(k.conname,7)='tenant_'
      loop
        execute format('alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
        n:=n+1;
      end loop;
      if n<>31 then raise exception 'Expected 31 validated tenant FKs, found %',n; end if;
    end;
    $validate$;
    select private.enable_legacy_write_scope(private.legacy_scope_snapshot());`);
  // The two operational gates are opened only inside this disposable loopback database.
  sql("update private.business_sales_gate set enabled=true where singleton");

  for (const owner of owners) {
    const { data, error } = await admin.auth.admin.createUser({
      email: owner.email, password, email_confirm: true,
    });
    if (error) throw error;
    owner.id = data.user.id;
  }

  app = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1"], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: API,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      DEPOTFLOW_PUBLIC_SIGNUP_ENABLED: "false",
      NEXT_PUBLIC_BUSINESS_SALES_ENABLED: "true" },
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

  // Seed one tenant-A product/customer through admin SQL for a deterministic
  // checkout fixture. The bypassed write triggers are restored in the same
  // transaction; this script is guarded to a disposable loopback database.
  const crateId = randomUUID();
  const productId = randomUUID();
  const customerId = randomUUID();
  sql(`begin;
    alter table public.crate_types disable trigger legacy_scope_business_write;
    alter table public.products disable trigger legacy_scope_business_write;
    alter table public.customers disable trigger legacy_scope_business_write;
    alter table public.stock disable trigger legacy_scope_business_write;
    insert into public.crate_types(id,business_id,name,empty_family,pocket_count)
      values ('${crateId}','${businessA}','E2E return crate','NBL',20);
    insert into public.products(
      id,business_id,name,size,bottles_per_crate,full_crate_price,half_crate_price,
      quarter_crate_price,bottle_price,bottles_returnable,empty_family,crate_type,
      bottle_type,crate_type_id,is_active
    ) values (
      '${productId}','${businessA}','E2E Lager','50cl',20,8000,4000,2000,500,
      true,'NBL','E2E return crate','E2E return bottle','${crateId}',true
    );
    insert into public.customers(id,name,phone,business_id,empties_deposit_required)
      values ('${customerId}','E2E Customer','08000000009','${businessA}',false);
    insert into public.stock(product_id,total_bottles,business_id)
      values ('${productId}',40,'${businessA}');
    alter table public.crate_types enable trigger legacy_scope_business_write;
    alter table public.products enable trigger legacy_scope_business_write;
    alter table public.customers enable trigger legacy_scope_business_write;
    alter table public.stock enable trigger legacy_scope_business_write;
    commit;`);

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
  const deniedA = await ownerBPage.goto(APP + `/businesses/${businessA}/drinks`);
  await ownerBPage.waitForLoadState("domcontentloaded");
  assert.equal(deniedA?.status(), 404, "Owner B direct access to Owner A depot must return 404");
  assert.equal(await ownerBPage.getByText(owners[0].name, { exact: true }).count(), 0,
    "Owner B can read Owner A's depot name through a direct URL");

  const deniedB = await page.goto(APP + `/businesses/${businessB}/drinks`);
  await page.waitForLoadState("domcontentloaded");
  assert.equal(deniedB?.status(), 404, "Owner A direct access to Owner B depot must return 404");
  assert.equal(await page.getByText(owners[1].name, { exact: true }).count(), 0,
    "Owner A can read Owner B's depot name through a direct URL");

  // Exercise the new tenant-specific checkout end to end as Owner A.
  await page.goto(APP + `/businesses/${businessA}/sales`);
  await page.getByRole("heading", { name: "Record a sale" }).waitFor();
  await page.getByLabel("Customer").selectOption(customerId);
  await page.getByLabel("Drink").selectOption(productId);
  await page.getByLabel("Full crates").fill("1");
  await page.getByRole("button", { name: "Add drink to sale" }).click();
  await page.getByLabel("E2E return crate crates returned").fill("1");
  await page.getByLabel("E2E return bottle bottles returned").fill("10");
  await page.getByLabel("Amount received (₦)").fill("3000");
  await page.getByLabel("Payment method").selectOption("cash");
  await page.getByRole("button", { name: "Record sale" }).click();
  await page.getByText("Sale recorded", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("link", { name: /View and share receipt/ }).click();
  await page.getByText("Saved depot receipt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Share receipt" }).waitFor();
  const saleMatch = page.url().match(/\/businesses\/[0-9a-f-]+\/sales\/([0-9a-f-]+)\/receipt$/);
  assert.ok(saleMatch, "Successful checkout did not open its tenant receipt");
  const saleId = saleMatch[1];

  assert.equal(sql(`select total_bottles from public.stock where product_id='${productId}'`), "20",
    "Checkout did not reduce only the sold product stock");
  assert.equal(sql(`select quantity from public.empty_crate_stock where crate_type_id='${crateId}'`), "1",
    "Returned crate was not added to this depot's empty-crate stock");
  assert.equal(sql(`select quantity from public.empty_bottle_stock where business_id='${businessA}' and bottle_type='E2E return bottle'`), "10",
    "Returned bottles were not added to this depot's empty-bottle stock");
  assert.equal(sql(`select amount from public.money_owed where customer_id='${customerId}'`), "5000",
    "Partial payment did not create the expected customer debt");
  assert.equal(sql(`select quantity from public.bottle_obligations where customer_id='${customerId}'`), "10",
    "Unreturned empty bottles were not left owed by the customer");
  assert.equal(sql(`select count(*) from public.sales where id='${saleId}' and business_id='${businessA}'`), "1",
    "Sale was not persisted under the correct business");
  assert.equal(sql(`select receipt_customer_name from public.sales where id='${saleId}'`), "E2E Customer",
    "Receipt did not capture the customer name");
  assert.equal(sql(`select receipt_business->>'name' from public.sales where id='${saleId}'`), owners[0].name,
    "Receipt did not capture the correct depot profile");

  const deniedReceipt = await ownerBPage.goto(APP + `/businesses/${businessA}/sales/${saleId}/receipt`);
  assert.equal(deniedReceipt?.status(), 404, "Owner B direct access to Owner A's receipt must return 404");

  console.log("PASS: two real browser sessions registered separate depots; picker and direct-URL checks did not leak tenant names.");
  await ownerBContext.close();
} finally {
  if (browser) await browser.close();
  if (app && app.exitCode === null) app.kill("SIGTERM");
  // Disposable stack is destroyed by the workflow even if this script fails.
}
