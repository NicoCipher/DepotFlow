import assert from "node:assert/strict";
import { test } from "node:test";
import { parseThemePreference, resolveTheme } from "./theme.ts";

test("theme defaults to system for missing or invalid saved values", () => {
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference(""), "system");
  assert.equal(parseThemePreference("unknown"), "system");
});

test("explicit preferences override system appearance", () => {
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

test("system preference follows device appearance", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});
