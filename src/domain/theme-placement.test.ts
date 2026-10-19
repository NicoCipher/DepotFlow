import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../components/shop-navigation.tsx", import.meta.url), "utf8");
const selector = readFileSync(new URL("../components/theme-select.tsx", import.meta.url), "utf8");

test("appearance is in desktop and mobile More menus, not the main header", () => {
  assert.doesNotMatch(shell, /ThemeSelect/);
  assert.equal((navigation.match(/<ThemeSelect\s*\/>/g) ?? []).length, 2);
  assert.equal((navigation.match(/<section aria-label="Appearance"/g) ?? []).length, 2);
});

test("two More menus have distinct accessible theme select labels", () => {
  assert.match(selector, /const selectId = useId\(\)/);
  assert.match(selector, /htmlFor=\{selectId\}/);
  assert.match(selector, /id=\{selectId\}/);
  assert.match(selector, /value=\{preference\}/);
});
