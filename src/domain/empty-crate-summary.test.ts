import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeEmptyCrates, type StockCrate } from "./empty-crate-summary.ts";

const crate = (id: string, name: string, brewery: string | null, quantity: number | null,
  pocket_count: number | null = 12, is_legacy = false): StockCrate => ({
  crate_type_id: id, name, empty_family: brewery, quantity, pocket_count, is_legacy,
});

test("shared shapes and names never merge exact branded crate identities", () => {
  const summary = summarizeEmptyCrates([
    crate("heineken", "Heineken", "NBL", 4),
    crate("gulder", "Gulder", "NBL", 3),
    crate("33", "33", "NBL", 5),
    crate("life", "Life", "NBL", 7),
    crate("goldberg", "Goldberg", "NBL", 2),
    crate("trophy", "Trophy shared physical crate", "International Breweries", 6),
  ]);
  assert.equal(summary.countedTotal, 27);
  assert.equal(summary.groups[1].countedTotal, 21);
  assert.equal(summary.groups[1].crates.length, 5);
  assert.equal(summary.groups[0].countedTotal, 6);
});

test("unknown count is not zero, and legacy records with stock are included", () => {
  const result = summarizeEmptyCrates([
    crate("a", "Goldberg", "NBL", null),
    crate("b", "Gulder", "NBL", 0),
    crate("old", "Old exact crate", null, 3, null, true),
  ]);
  assert.equal(result.countedTotal, 3);
  assert.equal(result.missingCounts, 1);
  assert.equal(result.groups.find(group => group.brewery === "Needs setup")?.countedTotal, 3);
});

test("reject duplicate stock IDs rather than silently double-counting them", () => {
  assert.throws(() => summarizeEmptyCrates([
    crate("same", "Gulder", "NBL", 2),
    crate("same", "Heineken", "NBL", 4),
  ]), /repeated identity/);
  assert.throws(() => summarizeEmptyCrates([crate("bad", "33", "NBL", -1)]), /Invalid/);
});

test("NB and NBL are one brewery subtotal but five distinct branded crate counts", () => {
  const report = summarizeEmptyCrates([
    crate("33", "33", "NB", 2),
    crate("life", "Life", "NBL", 3),
    crate("goldberg", "Goldberg", "nbl", 4),
    crate("gulder", "Gulder", "NB", 5),
    crate("heineken", "Heineken", "NBL", null),
  ]);
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].brewery, "NB");
  assert.equal(report.groups[0].crates.length, 5);
  assert.equal(report.groups[0].countedTotal, 14);
  assert.equal(report.countedTotal, 14);
  assert.equal(report.missingCounts, 1);
});
