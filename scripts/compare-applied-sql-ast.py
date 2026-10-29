#!/usr/bin/env python3
"""Compare preserved production-applied SQL to local candidates using PostgreSQL ASTs.

This is a diagnostic. AST equality is stronger than whitespace normalization but
is not a full proof of runtime semantic equivalence or platform parity.
"""
import json
import re
from pathlib import Path

from pglast.parser import parse_sql_json

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/release-evidence/production-applied-sql-statements-lexical-only-20261029.json"
MANIFEST = ROOT / "docs/m2-applied-sql-reconciliation-manifest-20261019.json"
MIGRATIONS = ROOT / "supabase/migrations"
POSITION_KEYS = {"location", "stmt_location", "stmt_len"}


def remove_locations(value):
    if isinstance(value, dict):
        return {k: remove_locations(v) for k, v in value.items() if k not in POSITION_KEYS}
    if isinstance(value, list):
        return [remove_locations(v) for v in value]
    return value


def parse_tree(sql):
    return remove_locations(json.loads(parse_sql_json(sql)))


def statement_types(tree):
    return [next(iter(item.get("stmt", {})), "unknown") for item in tree.get("stmts", [])]


def compare():
    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    candidates = {x["version"]: x for x in manifest["entries"]}
    report = {
        "captured_on": evidence["captured_on"],
        "method": "pglast/libpg_query PostgreSQL parse-tree comparison; source locations removed",
        "warning": "AST equality is not a complete runtime-semantic, data-migration, or Supabase managed-platform certificate.",
        "counts": {},
        "entries": [],
    }
    counts = {"ast_equal": 0, "ast_different": 0, "parse_error": 0, "candidate_missing": 0}
    for row in evidence["entries"]:
        version = row["version"]
        source = candidates.get(version, {}).get("localCandidate")
        result = {"version": version, "name": row["name"], "source": source,
                  "applied_statement_count": len(row.get("statements") or [])}
        if not source or not (MIGRATIONS / source).is_file():
            result["status"] = "candidate_missing"
            counts["candidate_missing"] += 1
        else:
            try:
                applied_sql = row.get("statements") or []
                applied_trees = []
                for statement in applied_sql:
                    applied_trees.extend(parse_tree(statement).get("stmts", []))
                applied_tree = {"stmts": applied_trees}
                local_tree = parse_tree((MIGRATIONS / source).read_text(encoding="utf-8"))
                same = applied_tree == local_tree
                result["status"] = "ast_equal" if same else "ast_different"
                result["applied_parsed_statement_count"] = len(applied_trees)
                result["source_parsed_statement_count"] = len(local_tree.get("stmts", []))
                result["applied_top_level_types"] = statement_types(applied_tree)
                result["source_top_level_types"] = statement_types(local_tree)
                if not same:
                    counts["ast_different"] += 1
                    result["review_required"] = True
                else:
                    counts["ast_equal"] += 1
            except Exception as exc:
                result["status"] = "parse_error"
                result["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
                counts["parse_error"] += 1
        report["entries"].append(result)
    report["counts"] = counts
    report["release_decision"] = "NO-GO" if counts["ast_different"] or counts["parse_error"] or counts["candidate_missing"] else "AST_MATCH_ONLY_NOT_RELEASE_AUTHORIZATION"
    return report


if __name__ == "__main__":
    print(json.dumps(compare(), indent=2, sort_keys=True))
