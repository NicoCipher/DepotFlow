import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const accepted = [
  "33-export-60cl", "amstel-malta-33cl", "guinness-stout-big-60cl",
  "budweiser-60cl", "gulder-60cl", "legend-60cl",
  "life-60cl", "malta-guinness-33cl", "guinness-stout-small-33cl",
  "smirnoff-ice-small-33cl", "star-60cl", "star-radler-citrus-45cl",
  "trophy-lager-60cl"
];
const rejected = ["desperados-45cl", "tiger-45cl", "turbo-king-big-60cl"];

test("all 13 linked shop photos are real stored WebP files, not remote URLs", () => {
  assert.equal(new Set(accepted).size, 13);
  for (const slug of accepted) {
    const url = new URL(`public/catalogue-photos/${slug}.webp`, root);
    assert.ok(existsSync(url), `Missing file for ${slug}`);
    const bytes = readFileSync(url);
    assert.ok(bytes.length > 6000 && bytes.length <= 1024 * 1024, `Suspect file size ${slug}`);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  }
});

test("placeholder and unverified source variants are not bundled or linked", () => {
  for (const slug of rejected) assert.ok(!existsSync(new URL(`public/catalogue-photos/${slug}.webp`, root)), `Unexpected image for ${slug}`);
});

test("source manifest identifies all 13 genuine products and records provenance", () => {
  const data = JSON.parse(readFileSync(new URL("docs/shop-photo-source-manifest.json", root), "utf8"));
  for (const slug of accepted) {
    const row = data.items.find((item: {slug: string}) => item.slug === slug);
    assert.ok(row && row.source_page.startsWith("https://") && row.source_image.startsWith("https://"), `Missing provenance for ${slug}`);
  }
});
