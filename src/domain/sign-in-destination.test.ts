import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadResolver() {
  const source = readFileSync(
    new URL("../lib/auth/sign-in-destination.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", js)(
    (name: string) => {
      if (name === "server-only") return {};
      if (name === "@/domain/authorization") {
        return {
          ownerAuthorized: (userId: string, isOwner: unknown, error: unknown) =>
            Boolean(userId) && isOwner === true && !error,
        };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports as {
    resolveSignInDestination: (
      supabase: { rpc: (name: string) => Promise<{ data: unknown; error: unknown }> },
      userId: string,
    ) => Promise<string | null>;
  };
}

function client(
  responses: Record<string, { data: unknown; error: unknown }>,
  calls: string[] = [],
) {
  return {
    calls,
    rpc: async (name: string) => {
      calls.push(name);
      const response = responses[name];
      if (!response) throw new Error(`Unexpected RPC: ${name}`);
      return response;
    },
  };
}

const resolver = loadResolver().resolveSignInDestination;

test("one setup depot opens directly into its setup flow", async () => {
  const supabase = client({
    list_my_businesses_for_setup: {
      data: [{ business_id: "setup-id", business_status: "setup" }],
      error: null,
    },
  });
  assert.equal(
    await resolver(supabase, "owner-a"),
    "/businesses/setup-id/drinks",
  );
  assert.deepEqual(supabase.calls, ["list_my_businesses_for_setup"]);
});

test("one active depot opens directly into its sales route", async () => {
  const supabase = client({
    list_my_businesses_for_setup: {
      data: [{ business_id: "active-id", business_status: "active" }],
      error: null,
    },
  });
  assert.equal(
    await resolver(supabase, "owner-a"),
    "/businesses/active-id/sales",
  );
});

test("multiple depots require an explicit choice", async () => {
  const supabase = client({
    list_my_businesses_for_setup: {
      data: [
        { business_id: "a", business_status: "active" },
        { business_id: "b", business_status: "setup" },
      ],
      error: null,
    },
  });
  assert.equal(await resolver(supabase, "owner-a"), "/businesses");
  assert.deepEqual(supabase.calls, ["list_my_businesses_for_setup"]);
});

test("first-depot registration still requires its independent gate", async () => {
  const allowed = client({
    list_my_businesses_for_setup: { data: [], error: null },
    can_register_business: { data: true, error: null },
  });
  assert.equal(await resolver(allowed, "new-owner"), "/businesses");

  const denied = client({
    list_my_businesses_for_setup: { data: [], error: null },
    can_register_business: { data: false, error: null },
    is_shop_owner: { data: false, error: null },
  });
  assert.equal(await resolver(denied, "unknown-user"), null);
});

test("legacy shop owners retain access when tenant listing is unavailable", async () => {
  const supabase = client({
    list_my_businesses_for_setup: { data: null, error: { message: "gate closed" } },
    is_shop_owner: { data: true, error: null },
  });
  assert.equal(await resolver(supabase, "legacy-owner"), "/");
  assert.deepEqual(supabase.calls, [
    "list_my_businesses_for_setup",
    "is_shop_owner",
  ]);
});
