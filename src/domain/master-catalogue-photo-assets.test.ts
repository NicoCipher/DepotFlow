import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const approved = ["maltina-classic-can-33cl", "maltina-classic-glass-33cl"] as const;
const rejected = ["maltina-classic-pet-33cl", "fayrouz-pineapple-can-33cl", "chamdor-red-75cl"] as const;

test("new full-master catalogue bottle and can photographs are genuine optimized first-party WebPs", () => {
  for (const slug of approved) {
    const path = new URL(`public/catalogue-photos/${slug}.webp`, root);
    const data = readFileSync(path);
    assert.ok(data.length > 10000 && data.length < 1024 * 1024);
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    assert.equal(data.toString("ascii", 8, 12), "WEBP");
  }
});

test("reject watermarks, multipack advertising and fake pharmacy artwork", () => {
  for (const slug of rejected)
    assert.ok(!existsSync(new URL(`public/catalogue-photos/${slug}.webp`, root)), `Rejected ${slug} should not ship`);
});
