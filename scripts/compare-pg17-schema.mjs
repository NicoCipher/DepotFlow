#!/usr/bin/env node
/**
 * Compare a current, independently collected PG17 staging schema fingerprint
 * with DepotFlow's read-only production baseline.
 *
 * This is a STRICT public/private schema equality preflight, not a schema
 * clone creator, SQL migration runner, or production release certificate.
 *
 * Clone input is JSON:
 *  {"project_ref":"<isolated Supabase branch ref>",
 *   "postgres_version":"17.6", "source_query":"supabase/tests/live_schema_fingerprint.sql",
 *   "objects":[{"kind":"columns","object_count":219,"definition_hash":"..."}]}
 *
 * The expected 8 object groups must be present. Fingerprints are generated
 * by the SQL query run on a real separate database (do not copy baseline).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
export const LIVE_REF = "coyivbklakhilpcqqrzg";
export const KINDS = [
  "column_grants", "columns", "constraints", "functions",
  "indexes", "policies", "relations", "triggers",
];

function isDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}
function collect(input, type) {
  if (!input || typeof input !== "object" || !Array.isArray(input.objects) ||
      input.objects.length !== KINDS.length) {
    throw new Error(type + ": exactly eight schema object groups are required.");
  }
  const rows = new Map();
  for (const record of input.objects) {
    if (!record || !KINDS.includes(record.kind) || rows.has(record.kind) ||
        !Number.isSafeInteger(record.object_count) ||
        record.object_count < 0 || !isDigest(record.definition_hash)) {
      throw new Error(type + ": invalid or duplicate fingerprint group.");
    }
    rows.set(record.kind, {
      count: record.object_count,
      hash: record.definition_hash,
    });
  }
  if (KINDS.some(kind => !rows.has(kind))) {
    throw new Error(type + ": missing fingerprint group.");
  }
  return rows;
}

export function compareSchemaFingerprints(prod, clone) {
  if (prod.project !== "DepotFlow" || prod.method !==
      "read-only query supabase/tests/live_schema_fingerprint.sql") {
    throw new Error("Production baseline has unexpected provenance.");
  }
  if (!clone || typeof clone.project_ref !== "string" ||
      !/^[a-z0-9]{20}$/.test(clone.project_ref) ||
      clone.project_ref === LIVE_REF ||
      clone.source_query !== "supabase/tests/live_schema_fingerprint.sql" ||
      !/^17(?:\.|$)/.test(clone.postgres_version ?? "") ||
      !/^17(?:\.|$)/.test(prod.postgres ?? "")) {
    throw new Error("CLONE BLOCKED: need a separate, identified PG17 Supabase branch and the exact read-only query.");
  }
  const expected = collect(prod, "production");
  const actual = collect(clone, "clone");
  const diffs = [];
  for (const kind of KINDS) {
    const a = expected.get(kind), b = actual.get(kind);
    if (a.count !== b.count || a.hash !== b.hash) {
      diffs.push({
        kind,
        expected_count: a.count, actual_count: b.count,
        expected_hash: a.hash, actual_hash: b.hash,
      });
    }
  }
  return { matches: diffs.length === 0, diffs, compared: KINDS.length };
}

function main(args) {
  if (args.length !== 2 || args[0] !== "--clone") {
    throw new Error("Usage: node scripts/compare-pg17-schema.mjs --clone <fresh-read-only-clone-fingerprint.json>");
  }
  const baselinePath = resolve(dirname(SELF), "../docs/release-evidence/production-schema-fingerprint-20261019.json");
  const prod = JSON.parse(readFileSync(baselinePath, "utf8"));
  const clone = JSON.parse(readFileSync(resolve(args[1]), "utf8"));
  const comparison = compareSchemaFingerprints(prod, clone);
  if (!comparison.matches) {
    for (const mismatch of comparison.diffs) {
      console.error(JSON.stringify(mismatch));
    }
    throw new Error("CLONE BLOCKED: production application schema fingerprint drift.");
  }
  console.log("MATCH: eight public/private schema object groups match the saved baseline.");
  console.log("NOT APPROVED: Auth/Storage/role settings, history, production data, and post-upgrade migrations still need independent validation.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error?.message ?? "Unexpected fingerprint error.");
    process.exitCode = 2;
  }
}
