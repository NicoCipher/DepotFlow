#!/usr/bin/env python3
"""Compare a disposable 124-stage reconstruction with read-only live snapshots.

Raw REFERENCES grants are deliberately excluded from app-client parity because
Supabase manages those separately. All application DML and effective DELETE
permissions are compared exactly. No production connection or writes occur.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_SNAPSHOT = ROOT / "docs/release-evidence/production-schema-fingerprint-20261115.json"
OBJECT_SNAPSHOT = ROOT / "docs/release-evidence/hosted-schema-per-object-digests-20261115.json"
ACL_SNAPSHOT = ROOT / "docs/release-evidence/production-app-client-column-dml-acl-20261115.json"
EXPECTED_GROUPS = {
    "column_grants", "columns", "constraints", "functions",
    "indexes", "policies", "relations", "triggers",
}
APP_ACL_KEYS = (
    "counts_by_role_and_privilege",
    "per_table",
    "effective_delete_by_table",
)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def compare(args) -> dict:
    schema_expected = read_json(SCHEMA_SNAPSHOT)
    object_expected = read_json(OBJECT_SNAPSHOT)
    acl_expected = read_json(ACL_SNAPSHOT)
    for snapshot in (schema_expected, object_expected, acl_expected):
        if snapshot.get("migration_count") != 124 or snapshot.get("migration_tip") != "20261104172847":
            raise ValueError("Live schema snapshot is not bound to the reviewed 124-entry production ledger")
        if snapshot.get("project_id", snapshot.get("project_ref")) != "coyivbklakhilpcqqrzg":
            raise ValueError("Live schema snapshot belongs to an unexpected Supabase project")

    actual_groups = {}
    for line in args.schema_groups.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        fields = line.split("|")
        if len(fields) != 3:
            raise ValueError("Malformed schema group fingerprint line: " + line)
        kind, count, digest = fields
        if kind in actual_groups:
            raise ValueError("Duplicate schema group fingerprint: " + kind)
        actual_groups[kind] = {"object_count": int(count), "definition_hash": digest}
    expected_groups = {
        row["kind"]: {"object_count": row["object_count"], "definition_hash": row["definition_hash"]}
        for row in schema_expected["objects"]
    }
    if set(actual_groups) != EXPECTED_GROUPS or set(expected_groups) != EXPECTED_GROUPS:
        raise ValueError("Missing or unexpected schema fingerprint groups")
    # Supabase adds managed REFERENCES grants. Application DML parity is
    # checked separately below; all other schema groups must match exactly.
    group_differences = {
        kind: {"expected": expected_groups[kind], "actual": actual_groups[kind]}
        for kind in EXPECTED_GROUPS - {"column_grants"}
        if expected_groups[kind] != actual_groups[kind]
    }

    object_rows = read_json(args.object_digests)
    if isinstance(object_rows, dict) and "fingerprints" in object_rows:
        actual_objects = json.loads(object_rows["fingerprints"])
    elif isinstance(object_rows, dict):
        actual_objects = object_rows
    else:
        raise ValueError("Malformed disposable per-object fingerprint output")
    object_differences = {}
    if object_expected.get("shape_by_kind") != actual_objects.get("shape_by_kind"):
        expected_shape = object_expected.get("shape_by_kind", {})
        actual_shape = actual_objects.get("shape_by_kind", {})
        object_differences["shape_by_kind"] = {
            "expected_keys": len(expected_shape),
            "actual_keys": len(actual_shape),
        }
    expected_functions = object_expected.get("functions", {})
    actual_functions = actual_objects.get("functions", {})
    if expected_functions != actual_functions:
        expected_names = set(expected_functions)
        actual_names = set(actual_functions)
        object_differences["functions"] = {
            "added": sorted(actual_names - expected_names),
            "removed": sorted(expected_names - actual_names),
            "definition_hash_changed": sorted(
                name for name in expected_names & actual_names
                if expected_functions[name] != actual_functions[name]
            ),
        }

    acl_rows = read_json(args.app_client_acl)
    if isinstance(acl_rows, dict) and "fingerprint" in acl_rows:
        actual_acl = json.loads(acl_rows["fingerprint"])
    elif isinstance(acl_rows, dict):
        actual_acl = acl_rows
    else:
        raise ValueError("Malformed disposable application-client ACL output")
    acl_differences = {
        key: {
            "expected_count": len(acl_expected.get(key, {})),
            "actual_count": len(actual_acl.get(key, {})),
        }
        for key in APP_ACL_KEYS
        if acl_expected.get(key) != actual_acl.get(key)
    }

    if group_differences or object_differences or acl_differences:
        raise ValueError(json.dumps({
            "schema_group_differences": group_differences,
            "per_object_differences": object_differences,
            "application_client_acl_differences": acl_differences,
        }, indent=2))

    return {
        "result": "PASS",
        "live_baseline": "124 migrations ending 20261104172847",
        "schema_groups_exact": sorted(EXPECTED_GROUPS - {"column_grants"}),
        "per_object_shape_and_function_hashes": "exact",
        "application_client_DML_and_effective_DELETE": "exact",
        "raw_REFERENCES_grants": "excluded as Supabase-managed; not treated as app DML",
        "production_release_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema-groups", type=Path, required=True)
    parser.add_argument("--object-digests", type=Path, required=True)
    parser.add_argument("--app-client-acl", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(compare(args), indent=2))
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print("CURRENT 124-STAGE SCHEMA PARITY BLOCKED: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
