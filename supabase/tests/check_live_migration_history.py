#!/usr/bin/env python3
"""Read-only Supabase migration-history reconciliation gate.

This script NEVER connects to production or executes SQL. Give it a fresh,
independently retrieved list of live Supabase migrations in JSON form.
A successful check means version/name records align for historical entries;
it does NOT prove schema or applied-SQL equivalence, which require clone review.

Usage:
  python3 supabase/tests/check_live_migration_history.py \\
    --remote-history supabase/tests/fixtures/production_migration_history_20261018.json
This intentionally exits nonzero while known DepotFlow history has drift.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "migrations"
PATTERN = re.compile(r"^(\d{14})_([a-z][a-z0-9_]*)\.sql$")


def local_migrations(directory: Path = ROOT) -> dict[str, str]:
    items: dict[str, str] = {}
    for file in directory.glob("*.sql"):
        found = PATTERN.fullmatch(file.name)
        if found is None:
            raise ValueError(f"Invalid local migration filename: {file.name}")
        version, name = found.groups()
        if version in items:
            raise ValueError(f"Duplicate local migration version: {version}")
        items[version] = name
    if not items:
        raise ValueError("No local migration files found")
    return items


def remote_migrations(payload: object) -> dict[str, str | None]:
    if isinstance(payload, dict):
        versions = payload.get("versions")
        names = payload.get("names", {})
    else:
        versions, names = payload, {}
    if not isinstance(versions, list) or not isinstance(names, dict):
        raise ValueError("Remote history must have 'versions' list and optional 'names' map")
    result: dict[str, str | None] = {}
    for item in versions:
        version = item if isinstance(item, str) else item.get("version") if isinstance(item, dict) else None
        if not isinstance(version, str) or not re.fullmatch(r"\d{14}", version):
            raise ValueError(f"Invalid remote migration version: {item!r}")
        if version in result:
            raise ValueError(f"Duplicate remote migration version: {version}")
        name = names.get(version)
        if name is not None and (not isinstance(name, str) or not name):
            raise ValueError(f"Invalid remote migration name for {version}")
        result[version] = name
    if not result:
        raise ValueError("Empty remote migration history")
    if any(key not in result for key in names):
        raise ValueError("Remote migration name without corresponding version")
    return result


def problems(local: dict[str, str], remote: dict[str, str | None]) -> list[str]:
    tip = max(remote)
    foreign = sorted(set(remote) - set(local))
    old_unapplied = sorted(v for v in local if v <= tip and v not in remote)
    renamed = sorted(v for v in set(remote).intersection(local)
                     if remote[v] is not None and remote[v] != local[v])
    issues = []
    if foreign:
        issues.append(f"{len(foreign)} live versions absent locally: {foreign}")
    if old_unapplied:
        issues.append(f"{len(old_unapplied)} historical local versions absent live: {old_unapplied}")
    if renamed:
        issues.append(f"{len(renamed)} same-version filename name mismatches: {renamed}")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote-history", required=True, type=Path,
                        help="Fresh SELECT-only Supabase migration export as JSON")
    args = parser.parse_args()
    try:
        local = local_migrations()
        remote = remote_migrations(json.loads(args.remote_history.read_text(encoding="utf8")))
        errors = problems(local, remote)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"RELEASE BLOCKED: {exc}", file=sys.stderr)
        return 2
    print(f"Local SQL files: {len(local)}; live applied: {len(remote)}; live tip: {max(remote)}")
    if errors:
        print("RELEASE BLOCKED: migration-version history differs. No migration was run.",
              file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        print("Review applied SQL on a schema-compatible isolated clone; never force "
              "migration repair or --include-all.", file=sys.stderr)
        return 2
    print("History version/name checks passed. NOT a live-schema or applied-SQL certificate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
