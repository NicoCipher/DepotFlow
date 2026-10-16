#!/usr/bin/env python3
"""Fail closed on ambiguous Supabase migration versions.

Supabase treats the 14-digit timestamp before '_' as a migration version,
not as part of an arbitrary filename. Two different SQL files with the
same version can pass naive file-by-file Postgres tests while breaking the
actual production migration history.
"""
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1] / "migrations"
files = sorted(root.glob("*.sql"))
if not files:
    sys.exit("No SQL migrations found; refusing to certify empty history.")

versions = defaultdict(list)
for path in files:
    match = re.fullmatch(r"(\d{14})_[a-z0-9][a-z0-9_]*\.sql", path.name)
    if match is None:
        sys.exit(f"Malformed migration filename: {path.name}")
    version = match.group(1)
    try:
        datetime.strptime(version, "%Y%m%d%H%M%S")
    except ValueError as exc:
        sys.exit(f"Invalid UTC migration timestamp {version} in {path.name}: {exc}")
    versions[version].append(path.name)

conflicts = [f"{version}: {', '.join(names)}"
             for version, names in versions.items() if len(names) != 1]
if conflicts:
    sys.exit("Duplicate Supabase migration versions:\n" + "\n".join(conflicts))

print(f"Verified {len(files)} unique, sortable Supabase migration versions.")
