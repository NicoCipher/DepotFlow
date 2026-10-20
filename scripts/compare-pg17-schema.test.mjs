import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareSchemaFingerprints, KINDS, LIVE_REF } from "./compare-pg17-schema.mjs";

const prod = JSON.parse(readFileSync(
  new URL("../docs/release-evidence/production-schema-fingerprint-20261019.json", import.meta.url),
  "utf8"
));
function clone() {
  return {
    project_ref: "abcdefghijklmnopqrst",
    postgres_version: "17.6",
    source_query: "supabase/tests/live_schema_fingerprint.sql",
    objects: structuredClone(prod.objects),
  };
}
test("an independently collected separate branch with matching 8 groups passes a snapshot comparison", () => {
  const result = compareSchemaFingerprints(prod, clone());
  assert.equal(result.matches, true);
  assert.equal(result.compared, 8);
  assert.deepEqual(result.diffs, []);
});
test("the production project is never accepted as a clone", () => {
  assert.throws(() => compareSchemaFingerprints(prod, { ...clone(), project_ref: LIVE_REF }), /CLONE BLOCKED/);
});
test("PG16 or URL flags cannot impersonate an identified PG17 branch", () => {
  assert.throws(() => compareSchemaFingerprints(prod, { ...clone(), postgres_version: "16.12" }), /CLONE BLOCKED/);
  assert.throws(() => compareSchemaFingerprints(prod, { ...clone(), source_query: "other.sql" }), /CLONE BLOCKED/);
  assert.throws(() => compareSchemaFingerprints(prod, { ...clone(), project_ref: "https://example.test" }), /CLONE BLOCKED/);
});
test("each schema object count and hash must match exactly", () => {
  for (const kind of KINDS) {
    const n = clone();
    const row = n.objects.find(x => x.kind === kind);
    row.object_count++;
    const failedCount = compareSchemaFingerprints(prod, n);
    assert.equal(failedCount.matches, false);
    assert.equal(failedCount.diffs[0].kind, kind);

    const m = clone();
    m.objects.find(x => x.kind === kind).definition_hash = "f".repeat(32);
    // In the unlikely event baseline equals all-fs, alter to zeros.
    if (m.objects.find(x => x.kind === kind).definition_hash === row.definition_hash) {
      m.objects.find(x => x.kind === kind).definition_hash = "0".repeat(32);
    }
    assert.equal(compareSchemaFingerprints(prod, m).matches, false);
  }
});
test("missing, duplicate or invented groups fail closed", () => {
  let b = clone();
  b.objects.pop();
  assert.throws(() => compareSchemaFingerprints(prod, b), /eight/);
  b = clone();
  b.objects[0] = structuredClone(b.objects[1]);
  assert.throws(() => compareSchemaFingerprints(prod, b), /duplicate/);
  b = clone();
  b.objects[0].kind = "auth_users";
  assert.throws(() => compareSchemaFingerprints(prod, b), /invalid/);
});
test("stale or forged production baseline metadata fails closed", () => {
  assert.throws(() => compareSchemaFingerprints({ ...prod, method: "guessed" }, clone()), /provenance/);
});
