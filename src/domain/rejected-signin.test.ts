import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(relative: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  new Function("require", "module", "exports", js)(
    (name: string) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
      return mocks[name];
    }, mod, mod.exports,
  );
  return mod.exports as unknown as {
    clearRejectedSignInCookies: () => Promise<boolean>;
    signIn: (state: { email: string; message: string }, form: FormData) => Promise<{ email: string; message: string }>;
  };
}

test("auth fallback deletes only this project's chunked and PKCE cookies", async () => {
  const names = new Set([
    "sb-coyivbklakhilpcqqrzg-auth-token.0",
    "sb-coyivbklakhilpcqqrzg-auth-token.1",
    "sb-coyivbklakhilpcqqrzg-auth-token-code-verifier",
    "sb-anotherproject-auth-token.0",
    "theme",
  ]);
  const cookies = {
    getAll: () => [...names].map((name) => ({ name })),
    delete: (name: string) => { names.delete(name); },
    get: (name: string) => names.has(name) ? { name } : undefined,
  };
  const m = compile("../lib/auth/rejected-signin-cleanup.ts", {
    "server-only": {},
    "next/headers": { cookies: async () => cookies },
    "@/lib/supabase/config": {
      supabaseConfig: () => ({ url: "https://coyivbklakhilpcqqrzg.supabase.co" }),
    },
  });
  assert.equal(await m.clearRejectedSignInCookies(), true);
  assert.deepEqual([...names].sort(), ["sb-anotherproject-auth-token.0", "theme"]);
});

test("unknown auth storage host cannot claim rejected-session cleanup", async () => {
  const m = compile("../lib/auth/rejected-signin-cleanup.ts", {
    "server-only": {},
    "next/headers": { cookies: async () => { throw new Error("unexpected"); } },
    "@/lib/supabase/config": {
      supabaseConfig: () => ({ url: "https://custom-auth.example.test" }),
    },
  });
  assert.equal(await m.clearRejectedSignInCookies(), false);
});

function form(returnTo = "/") {
  const data = new FormData();
  data.set("email", "depot@example.com");
  data.set("password", "valid-login");
  data.set("return_to", returnTo);
  return data;
}

function loginScenario(mode: "error" | "throw" | "ok", cleanup: boolean) {
  const redirects: string[] = [];
  let cleanupCalls = 0;
  let signOutCalls = 0;
  const mock = {
    auth: {
      signInWithPassword: async () => ({ data: { user: { id: "valid-user" } }, error: null }),
      signOut: async () => {
        signOutCalls++;
        if (mode === "throw") throw new Error("logout unavailable");
        return { error: mode === "error" ? { message: "logout failed" } : null };
      },
    },
    rpc: async (name: string) => {
      if (name === "is_shop_owner") return { data: false, error: null };
      if (name === "list_my_businesses_for_setup") return { data: [], error: null };
      if (name === "can_register_business") return { data: false, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const m = compile("../app/sign-in/actions.ts", {
    "next/navigation": {
      redirect: (url: string) => {
        redirects.push(url);
        throw new Error("redirect");
      },
    },
    "@/lib/supabase/server": { createClient: async () => mock },
    "@/domain/authorization": { ownerAuthorized: () => false },
    "@/domain/auth-navigation": {
      safeSignInReturnPath: (x: unknown) => x === "/businesses" ? "/businesses" : "/",
    },
    "@/lib/auth/rejected-signin-cleanup": {
      clearRejectedSignInCookies: async () => {
        cleanupCalls++;
        return cleanup;
      },
    },
  });
  return { api: m, redirects, calls: () => ({ signOutCalls, cleanupCalls }) };
}

test("rejected legacy and new-depot logins check returned logout errors", async () => {
  for (const destination of ["/", "/businesses"]) {
    const x = loginScenario("error", true);
    const state = await x.api.signIn({ email: "", message: "" }, form(destination));
    assert.match(state.message, /not available|shop owner/);
    assert.deepEqual(x.calls(), { signOutCalls: 1, cleanupCalls: 1 });
    assert.deepEqual(x.redirects, []);
  }
});

test("failed cookie cleanup does not falsely report a rejected login was cleaned", async () => {
  for (const mode of ["error", "throw"] as const) {
    const x = loginScenario(mode, false);
    const result = await x.api.signIn({ email: "", message: "" }, form());
    assert.match(result.message, /cleanup could not be confirmed/i);
    assert.deepEqual(x.calls(), { signOutCalls: 1, cleanupCalls: 1 });
    assert.deepEqual(x.redirects, []);
  }
});

test("successful Auth signOut does not call fallback cookie deletion", async () => {
  const x = loginScenario("ok", false);
  const r = await x.api.signIn({ email: "", message: "" }, form("/businesses"));
  assert.match(r.message, /not available/);
  assert.deepEqual(x.calls(), { signOutCalls: 1, cleanupCalls: 0 });
});
