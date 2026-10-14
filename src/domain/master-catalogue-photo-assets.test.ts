import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
// Hashes are from the manually inspected, approved real product packshots.
const approved = [
  ["maltina-classic-can-33cl", "e2889c9945e58b0a0b11690b32971ad492d55cb11fc0dfef2fe996ea08a03ee5"],
  ["maltina-classic-glass-33cl", "344ac6ba9af3f4989eaf7fd23f37a85aea3744d6b3ec8a7968bc712dc19d960a"],
] as const;
const rejected = ["maltina-classic-pet-33cl", "fayrouz-pineapple-can-33cl", "chamdor-red-75cl"] as const;

test("new full-master catalogue bottle and can photographs are genuine optimized first-party WebPs", () => {
  for (const [slug, approvedSha256] of approved) {
    const path = new URL(`public/catalogue-photos/${slug}.webp`, root);
    const data = readFileSync(path);
    assert.ok(data.length > 10000 && data.length < 1024 * 1024);
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    assert.equal(data.toString("ascii", 8, 12), "WEBP");
    assert.equal(createHash("sha256").update(data).digest("hex"), approvedSha256, `Unreviewed photo replaced approved ${slug}`);
  }
});

test("reject watermarks, multipack advertising and fake pharmacy artwork", () => {
  for (const slug of rejected)
    assert.ok(!existsSync(new URL(`public/catalogue-photos/${slug}.webp`, root)), `Rejected ${slug} should not ship`);
});
