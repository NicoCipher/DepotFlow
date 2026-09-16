import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as customers from "./customers.ts";
import { emptySaleDraft } from "./sale-builder.ts";
import {
  emptySaleDrafts,
  updateActiveSale,
  parkActiveSale,
  selectSaleCustomer,
  readSaleDrafts,
} from "./sale-drafts.ts";
// Exercise the existing server actions with Auth/Data API and navigation mocked;
// no customer fixtures or business writes are sent to Supabase by these tests.
function actions(fail = false, deny = false) {
  const inserts: unknown[] = [];
  const redirects: string[] = [];
  let authorized = 0;
  const loadedModule = {
    exports: {} as {
      addCustomerForSale: (
        id: string,
        previous: customers.CustomerFormState,
        data: FormData,
      ) => Promise<customers.CustomerFormState>;
      addCustomer: (
        id: string,
        previous: customers.CustomerFormState,
        data: FormData,
      ) => Promise<customers.CustomerFormState>;
    },
  };
  const source = readFileSync(
    new URL("../app/(shop)/customers/actions.ts", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const require = (name: string) => {
    if (name === "@/domain/customers") return customers;
    if (name === "next/cache") return { revalidatePath: () => {} };
    if (name === "next/navigation")
      return {
        redirect: (url: string) => {
          redirects.push(url);
          throw new Error("redirect");
        },
      };
    if (name === "@/lib/auth/owner")
      return {
        requireOwner: async () => {
          authorized++;
          if (deny) throw new Error("Owner only");
          return {
            from: (table: string) => {
              assert.equal(table, "customers");
              return {
                insert: (values: unknown) => {
                  inserts.push(values);
                  return {
                    select: () => ({
                      single: async () =>
                        fail
                          ? { error: { code: "network" }, data: null }
                          : { error: null, data: { id: "created" } },
                    }),
                  };
                },
              };
            },
          };
        },
      };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function("require", "module", "exports", code)(
    require,
    loadedModule,
    loadedModule.exports,
  );
  return {
    api: loadedModule.exports,
    inserts,
    redirects,
    authorized: () => authorized,
  };
}
const customerId = "90000000-0000-4000-8000-000000000001";
const previous = { values: customers.emptyCustomer, errors: {} };
function form(name = "New customer", phone = "08012345678") {
  const data = new FormData();
  data.set("name", name);
  data.set("phone", phone);
  return data;
}
function sale() {
  let state = updateActiveSale(
    emptySaleDrafts,
    null,
    { customerId: "paused-customer" },
    "paused",
  );
  state = parkActiveSale(state, "paused", "2026-09-16T10:00:00Z");
  return updateActiveSale(
    state,
    null,
    {
      ...emptySaleDraft,
      customerId: "old-customer",
      step: "customer",
      lines: [
        {
          productId: "drink",
          quantity: { crates: 2, fraction: 1, bottles: 3 },
        },
      ],
      editingId: "drink",
      crates: "2",
      fraction: 1,
      bottles: "3",
    },
    "active",
  );
}
test("shared customer creation returns the created ID for Record Sale and selects it without changing items or draft identity", async () => {
  const server = actions();
  const state = sale();
  const result = await server.api.addCustomerForSale(
    customerId,
    previous,
    form(),
  );
  assert.equal(result.createdId, customerId);
  assert.equal(server.inserts.length, 1);
  assert.equal(server.authorized(), 1);
  assert.deepEqual(server.redirects, []);
  const selected = selectSaleCustomer(
    state,
    "active",
    result.createdId!,
    "unused",
  );
  assert.equal(selected.active?.id, "active");
  assert.equal(selected.active?.draft.customerId, customerId);
  assert.equal(selected.active?.draft.step, "drinks");
  assert.deepEqual(selected.active?.draft.lines, state.active?.draft.lines);
  assert.equal(selected.active?.draft.bottles, "3");
  assert.deepEqual(selected.paused, state.paused);
});
test("cancelled creation needs no write; reopening retains active and paused drafts", () => {
  const state = sale();
  const server = actions();
  assert.deepEqual(readSaleDrafts(JSON.stringify(state)), state);
  assert.equal(server.inserts.length, 0);
});
test("validation errors use existing customer validation, insert nothing, and leave the sale intact", async () => {
  const server = actions();
  const state = sale();
  const before = JSON.stringify(state);
  const result = await server.api.addCustomerForSale(
    customerId,
    previous,
    form("", "bad phone"),
  );
  assert.ok(result.errors.name);
  assert.ok(result.errors.phone);
  assert.equal(result.values.phone, "bad phone");
  assert.equal(result.createdId, undefined);
  assert.equal(server.inserts.length, 0);
  assert.deepEqual(server.redirects, []);
  assert.equal(JSON.stringify(state), before);
});
test("failed customer creation does not select a customer or change the draft", async () => {
  const server = actions(true);
  const state = sale();
  const result = await server.api.addCustomerForSale(
    customerId,
    previous,
    form(),
  );
  assert.equal(result.createdId, undefined);
  assert.match(result.message!, /Could not save/);
  assert.equal(state.active?.draft.customerId, "old-customer");
});
test("normal Add Customer still saves through the same action and redirects to customer detail", async () => {
  const server = actions();
  await assert.rejects(
    server.api.addCustomer(customerId, previous, form()),
    /redirect/,
  );
  assert.equal(server.inserts.length, 1);
  assert.deepEqual(server.redirects, [`/customers/${customerId}?saved=added`]);
});
test("owner guard still runs before a customer write and a changed active draft cannot be overwritten", async () => {
  const server = actions(false, true);
  await assert.rejects(
    server.api.addCustomerForSale(customerId, previous, form()),
    /Owner only/,
  );
  assert.equal(server.inserts.length, 0);
  assert.throws(
    () => selectSaleCustomer(sale(), "different", customerId, "unused"),
    /active sale changed/,
  );
  const selected = selectSaleCustomer(
    emptySaleDrafts,
    null,
    customerId,
    "new-draft",
  );
  assert.equal(selected.active?.id, "new-draft");
  assert.equal(selected.active?.draft.step, "drinks");
});
