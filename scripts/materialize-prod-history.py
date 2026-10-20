#!/usr/bin/env python3
"""Materialize a read-only production SQL history into *temporary* local CI files.

Not a migration or production repair. It does not use a Supabase connection.
This consumes the 55-entry evidence manifest and refuses missing or tampered
archives. Intended exclusively for a disposable, data-free PostgreSQL 17 DB.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/m2-applied-sql-reconciliation-manifest-20261019.json"
START = "---------------- ORIGINAL APPLIED SQL (BEGIN) ----------------\n"
END = "\n---------------- ORIGINAL APPLIED SQL (END) ----------------"
ALLOWED = {"byte_exact", "lexical_only", "original_applied_sql_archived"}


def verified_sql(entry: dict) -> str:
    status = entry["status"]
    if status not in ALLOWED or not re.fullmatch(r"\d{14}", entry["version"]):
        raise ValueError("Invalid evidence record")
    if status == "original_applied_sql_archived":
        name = entry.get("archive")
        if not isinstance(name, str) or not name.startswith("docs/release-evidence/applied-") or not name.endswith(".sql.txt"):
            raise ValueError("Archive missing or misplaced")
        file = ROOT / name
        txt = file.read_text(encoding="utf8")
        if txt.count(START) != 1 or txt.count(END) != 1:
            raise ValueError("Missing original SQL boundaries: " + name)
        sql = txt.split(START)[1].split(END)[0]
        if hashlib.md5(sql.encode("utf8")).hexdigest() != entry["md5"]:
            raise ValueError("ARCHIVED SQL HASH MISMATCH: " + name)
        return sql
    candidate = entry.get("localCandidate")
    if not isinstance(candidate, str) or not re.fullmatch(r"\d{14}_[a-z0-9_]+\.sql", candidate):
        raise ValueError("Invalid repository candidate")
    return (ROOT / "supabase/migrations" / candidate).read_text(encoding="utf8")


def materialize(directory: Path) -> list[Path]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
    rows = manifest["entries"]
    if len(rows) != 55 or len({r["version"] for r in rows}) != 55 or not all(rows[i]["version"] < rows[i + 1]["version"] for i in range(54)):
        raise ValueError("Expected 55 unique, ordered original production versions")
    if manifest["release_authorized"] if "release_authorized" in manifest else False:
        raise ValueError("History snapshot must never authorize release")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    paths = []
    for i, row in enumerate(rows, 1):
        sql = verified_sql(row)
        if not sql.strip():
            raise ValueError("Empty applied SQL: " + row["version"])
        path = directory / f"{i:03d}_{row['version']}.sql"
        path.write_text(sql, encoding="utf8")
        paths.append(path)
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    options = parser.parse_args()
    files = materialize(options.out)
    print(f"Generated {len(files)} sandbox-only SQL stages. Not a release or migration-history repair.")


if __name__ == "__main__":
    main()
