import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const assets = [
  ["amstel-malta-33cl", "05be9ccba2ee02284e4e29903b5d04bad506328f927f3410550cf6f7f102e19c"],
  ["legend-60cl", "ad18c2c7d3e6dfca3d0cad79cf3e158c33d15415386d7922a3a975682207c942"],
] as const;

test("the two manually approved white-background real bottle packshots are bundled unchanged", () => {
  for (const [slug, hash] of assets) {
    const path = new URL(`../../public/catalogue-photos/${slug}.webp`, import.meta.url);
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 8000 && bytes.length < 1024 * 1024, `Suspicious ${slug} image file size`);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  }
});
