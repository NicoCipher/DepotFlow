import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { drinkArtworkCount, drinkArtworkPath } from "./drink-art.ts";

test("every master catalogue identity has bundled first-party artwork", () => {
  assert.equal(drinkArtworkCount, 45);
  const names = ["33","4th Street","Amstel","Amstel Can","Big Ice","Big Stout","Budweiser","Castle Lite","Chamdor","Desperados","Desperados Can","Fayrouz","Fayrouz Can","Flying Fish","Goldberg","Goldberg Black","Goldberg Can","Guinness Smooth","Gulder","Heineken","Heineken Can","Ice Black","Legend","Life","Malta","Malta Can","Maltina","Maltina Can","Maltina PET 25cl","Maltina PET 33cl","Maltina PET 50cl","Medium Heineken","Medium Legend","Medium Stout","Origin","Radler","Small Ice","Small Stout","Small Turbo","Star","Stout Can","Tiger","Trophy","Trophy Stout","Turbo"];
  for (const name of names) {
    const path = drinkArtworkPath(name);
    assert.ok(path.startsWith("/drink-art/"), name);
    assert.ok(existsSync(join(process.cwd(), "public", path.slice(1))), name + " has a bundled SVG");
  }
});
test("recognize shop names, do not let arbitrary input control an asset path", () => {
  assert.equal(drinkArtworkPath("Big Guinness Stout"), "/drink-art/big-stout.svg");
  assert.equal(drinkArtworkPath("Amstel Malta"), "/drink-art/amstel.svg");
  assert.equal(drinkArtworkPath("Small Smirnoff Ice"), "/drink-art/small-ice.svg");
  assert.equal(drinkArtworkPath("Turbo King"), "/drink-art/turbo.svg");
  assert.equal(drinkArtworkPath("../../secrets"), "/drink-art/generic.svg");
  assert.equal(drinkArtworkPath("Unknown Product"), "/drink-art/generic.svg");
});
