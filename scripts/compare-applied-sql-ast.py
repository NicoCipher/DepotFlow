#!/usr/bin/env python3
"""Compare preserved production-applied SQL to local candidates using PostgreSQL ASTs.

This is a diagnostic. AST equality is stronger than whitespace normalization but
is not a full proof of runtime semantic equivalence or platform parity.
"""
import json
import re
from pathlib import Path

from pglast.parser import parse_sql_json

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/release-evidence/production-applied-sql-statements-lexical-only-20261029.json"
MANIFEST = ROOT / "docs/m2-applied-sql-reconciliation-manifest-20261019.json"
MIGRATIONS = ROOT / "supabase/migrations"
POSITION_KEYS = {"location", "stmt_location", "stmt_len"}


def remove_locations(value):
    if isinstance(value, dict):
        return {k: remove_locations(v) for k, v in value.items() if k not in POSITION_KEYS and not k.endswith("_location")}
    if isinstance(value, list):
        return [remove_locations(v) for v in value]
    return value


def normalize_function_bodies(value, in_function=False):
    if isinstance(value, dict):
        out = {}
        for key, child in value.items():
            nested = in_function or key == "CreateFunctionStmt"
            out[key] = normalize_function_bodies(child, nested)
        return out
    if isinstance(value, list):
        return [normalize_function_bodies(child, in_function) for child in value]
    if in_function and isinstance(value, str) and "\\n" in value:
        # Function bodies are string literals to the SQL parser. Ignore only
        # full-line -- comments inside CREATE FUNCTION bodies; preserve all
        # executable text and string literals.
        return "\\n".join(line for line in value.splitlines() if not line.lstrip().startswith("--"))
    return value


def parse_tree(sql):
    return normalize_function_bodies(remove_locations(json.loads(parse_sql_json(sql))))


def strip_outer_transaction_wrappers(statements):
    if len(statements) >= 2:
        first = next(iter(statements[0].get("stmt", {})), "")
        last = next(iter(statements[-1].get("stmt", {})), "")
        if first == "TransactionStmt" and last == "TransactionStmt":
            return statements[1:-1]
    return statements


def statement_types(tree):
    return [next(iter(item.get("stmt", {})), "unknown") for item in tree.get("stmts", [])]


def summarize(value):
    if isinstance(value, str) and len(value) > 100:
        import hashlib
        return {"type":"string","length":len(value),"sha256":hashlib.sha256(value.encode()).hexdigest()[:12]}
    if isinstance(value, (dict,list)):
        import hashlib
        raw=json.dumps(value,sort_keys=True,separators=(",",":"))
        return {"type":"object" if isinstance(value,dict) else "array",
                "size":len(value),"sha256":hashlib.sha256(raw.encode()).hexdigest()[:12]}
    return value


def diff_paths(left, right, path="$", limit=10):
    out=[]
    def walk(a,b,p):
        if len(out)>=limit:
            return
        if isinstance(a,dict) and isinstance(b,dict):
            for key in sorted(set(a)|set(b)):
                if len(out)>=limit: return
                q=p+"."+key
                if key not in a: out.append({"path":q,"applied":"<missing>","source":summarize(b[key])})
                elif key not in b: out.append({"path":q,"applied":summarize(a[key]),"source":"<missing>"})
                else: walk(a[key],b[key],q)
        elif isinstance(a,list) and isinstance(b,list):
            if len(a)!=len(b):
                out.append({"path":p+".length","applied":len(a),"source":len(b)})
                return
            for i,(av,bv) in enumerate(zip(a,b)):
                if len(out)>=limit: return
                walk(av,bv,f"{p}[{i}]")
        elif a!=b:
            out.append({"path":p,"applied":summarize(a),"source":summarize(b)})
    walk(left,right,path)
    return out


def compare():
    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    candidates = {x["version"]: x for x in manifest["entries"]}
    report = {
        "captured_on": evidence["captured_on"],
        "method": "pglast/libpg_query PostgreSQL parse-tree comparison; source locations, full-line function-body comments, and paired outer BEGIN/COMMIT wrappers normalized",
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
                local_tree = parse_tree((MIGRATIONS / source).read_text(encoding="utf-8"))
                local_trees = local_tree.get("stmts", [])
                applied_trees = strip_outer_transaction_wrappers(applied_trees)
                local_trees = strip_outer_transaction_wrappers(local_trees)
                same = applied_trees == local_trees
                applied_tree = {"stmts": applied_trees}
                source_tree = {"stmts": local_trees}
                result["status"] = "ast_equal" if same else "ast_different"
                result["applied_parsed_statement_count"] = len(applied_trees)
                result["source_parsed_statement_count"] = len(local_trees)
                result["applied_top_level_types"] = statement_types(applied_tree)
                result["source_top_level_types"] = statement_types(source_tree)
                if not same:
                    result["ast_diff_samples"] = diff_paths(applied_tree, source_tree)
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
