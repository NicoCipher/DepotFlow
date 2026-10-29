#!/usr/bin/env python3
"""Fail-closed, metadata-only M2 historical-PG17 vs hosted-schema classifier.

Reads a fresh disposable historical 55-stage per-object JSON fingerprint and
the independently captured hosted 56-stage fingerprint. It does not connect
to any database, modify grants, infer semantic code equality from MD5, or
approve deployment. Unknown drift exits nonzero.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOSTED = ROOT / "docs/release-evidence/hosted-schema-per-object-digests-20261019.json"

AUTH_GATE = "private.business_auth_signup_gate"
EXPECTED_NEW = {
    "relations": {AUTH_GATE},
    "columns": {AUTH_GATE + ".singleton", AUTH_GATE + ".enabled"},
    "constraints": {AUTH_GATE + ".business_auth_signup_gate_pkey",
                    AUTH_GATE + ".business_auth_signup_gate_singleton_check"},
    "indexes": {"private.business_auth_signup_gate_pkey"},
}
EXPECTED_AUTH_FUNCTIONS = {
    "private.depotflow_before_user_created(event jsonb)",
    "private.depotflow_auth_user_insert_guard()",
}
EXPECTED_EXISTING_FUNCTION_DRIFT = {
    "private.record_payment(p_request_id uuid, p_customer_id uuid, p_amount numeric, p_business_date date)",
}


def differences(live: dict, historical: dict):
    """Return only harmless-known or actionable differences; no blind ignores."""
    if (live.get("project_ref") != "coyivbklakhilpcqqrzg" or
            live.get("migration_tip") != "20261019132131" or
            live.get("query") != "supabase/tests/fixtures/reconstructed_schema_object_hashes.sql"):
        raise ValueError("Unexpected live per-object reference provenance")

    shapes = live.get("shape_by_kind")
    hist_shapes = historical.get("shape_by_kind")
    if not isinstance(shapes, dict) or not isinstance(hist_shapes, dict) or (
        set(shapes) != set(EXPECTED_NEW) or set(hist_shapes) != set(EXPECTED_NEW)
    ):
        raise ValueError("Missing or new per-object shape categories")

    report = {}
    errors = []
    for kind, expected_new in EXPECTED_NEW.items():
        after, before = shapes[kind], hist_shapes[kind]
        added = set(after) - set(before)
        removed = set(before) - set(after)
        changed = {name for name in set(after) & set(before) if after[name] != before[name]}
        report[kind] = {
            "hosted_added": sorted(added),
            "historical_removed": sorted(removed),
            "existing_definition_changed": sorted(changed),
            "classification": "Auth-only gate object" if not removed and not changed
                              and added == expected_new else "UNCLASSIFIED",
        }
        if added != expected_new or removed or changed:
            errors.append(f"{kind}: unexpected additions/removals/definition hashes")
    live_func, hist_func = live.get("functions"), historical.get("functions")
    if not isinstance(live_func, dict) or not isinstance(hist_func, dict):
        raise ValueError("Function audit inventory missing")
    func_added = set(live_func) - set(hist_func)
    func_removed = set(hist_func) - set(live_func)
    func_changed = {k for k in set(live_func) & set(hist_func)
                    if live_func[k] != hist_func[k]}
    report["functions"] = {
        "hosted_added": sorted(func_added),
        "historical_removed": sorted(func_removed),
        "existing_definition_changed": sorted(func_changed),
        "classification": (
            "2 Auth-only functions; comment/whitespace-normalized historical payment function"
            if func_added == EXPECTED_AUTH_FUNCTIONS and not func_removed
            and func_changed == EXPECTED_EXISTING_FUNCTION_DRIFT else "UNCLASSIFIED"
        ),
        "caveat": "Hashes alone do not prove functional equivalence. Payment function body was independently compared after comment/whitespace normalization.",
    }
    if (func_added != EXPECTED_AUTH_FUNCTIONS or func_removed or
            func_changed != EXPECTED_EXISTING_FUNCTION_DRIFT):
        errors.append("functions: unexpected function definition/name differences")

    grant_live, grant_old = live.get("column_grants"), historical.get("column_grants")
    if not isinstance(grant_live, dict) or not isinstance(grant_old, dict):
        raise ValueError("Column grant audit missing")
    grant_diff = {k for k in set(grant_live)|set(grant_old)
                  if grant_live.get(k) != grant_old.get(k)}
    # DIFFERENCES in the raw granted references are expected from Supabase's
    # managed REFERENCES grants. This check is deliberately not used to
    # approve application DML permissions: the independently captured
    # is_grantable-aware DML + effective DELETE parity check remains mandatory.
    same_grant_tables = set(grant_live) == set(grant_old) and len(grant_live) == 29
    grant_ok = (same_grant_tables and len(grant_diff) == 28
                and sum(v["count"] for v in grant_live.values()) == 473
                and sum(v["count"] for v in grant_old.values()) == 238)
    report["column_grants"] = {
        "table_count": len(grant_live),
        "changed_tables": sorted(grant_diff),
        "hosted_entries": sum(v["count"] for v in grant_live.values()),
        "historical_entries": sum(v["count"] for v in grant_old.values()),
        "classification": (
            "235 additional hosted Supabase REFERENCES grants; client DML/DELETE parity must be separately verified"
            if grant_ok else "UNCLASSIFIED"
        ),
    }
    if not grant_ok:
        errors.append("column_grants: unknown grant inventory drift")
    return report, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--historical", type=Path, required=True,
                        help="per-object JSON emitted by disposable 55-stage PG17")
    parser.add_argument("--hosted", type=Path, default=HOSTED)
    args = parser.parse_args()
    hosted = json.loads(args.hosted.read_text())
    historical = json.loads(args.historical.read_text())
    report, errors = differences(hosted, historical)
    print(json.dumps({
        "result": "UNCLASSIFIED - STOP" if errors else "SIX CATEGORIES CLASSIFIED - STILL NO PRODUCTION AUTHORIZATION",
        "categories": report,
        "errors": errors,
        "does_not_certify": ["Supabase managed Auth/Storage service config",
                              "full role/grant parity", "actual restored data",
                              "live signup denial", "tenant SQL deployment"],
    }, indent=2))
    return 2 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
