#!/usr/bin/env python3
"""Release preflight for additive M2 tenancy migrations.

This intentionally distinguishes:
* disposable SQL CI, which proves function/schema compatibility;
* production migration history matching, which is REQUIRED before pushing.

Run with current production history freshly exported using a SELECT-only
query or Supabase migration list. Never run migration repair or db push
automatically as part of the preflight.
"""
import argparse
import json
import re
import sys
from pathlib import Path

M2_SUFFIXES = (
    "private_business_membership_foundation",
    "link_legacy_test_shop_business",
    "add_business_identity_to_tenant_tables",
    "guarded_legacy_scope_backfill",
    "tenant_aware_relationships",
    "legacy_operational_write_scope",
    "gate_legacy_owner_reads",
    "guard_legacy_reporting_rpcs",
    "dependency_ordered_legacy_backfill",
    "nonlegacy_business_profiles",
    "tenant_customer_access",
    "legacy_account_customer_scope",
    "legacy_customer_reader_scope",
    "guard_legacy_drink_lifecycle",
    "guard_legacy_write_rpc_entrypoints",
)
# This is a SNAPSHOT used only for testing the proposed branch; verify the
# actual current database maximum immediately before a production release.
RECORDED_PRODUCTION_TIP = "20261015233039"
ROOT = Path(__file__).resolve().parents[1] / "migrations"


def migration_versions():
    entries = {}
    for file in ROOT.glob("*.sql"):
        found = re.fullmatch(r"(\d{14})_([a-z][a-z0-9_]*)\.sql", file.name)
        if found is None:
            raise ValueError(f"Unrecognized migration name: {file.name}")
        version, suffix = found.groups()
        if version in entries:
            raise ValueError(f"Duplicate migration version: {version}")
        entries[version] = suffix
    return entries


def check_order(entries):
    version_by_suffix = {suffix: version for version, suffix in entries.items()}
    missing = [suffix for suffix in M2_SUFFIXES if suffix not in version_by_suffix]
    if missing:
        raise ValueError("Missing proposed tenancy migrations: " + ", ".join(missing))
    versions = [version_by_suffix[s] for s in M2_SUFFIXES]
    if versions != sorted(versions) or versions[0] <= RECORDED_PRODUCTION_TIP:
        raise ValueError(
            "M2 migrations must be ordered and strictly after the known "
            f"production tip {RECORDED_PRODUCTION_TIP}: {versions}"
        )
    return versions


def extract_remote_versions(value):
    if isinstance(value, dict) and "versions" in value:
        items = value["versions"]
    elif isinstance(value, list):
        items = value
    else:
        raise ValueError("Remote history must contain a versions list")
    versions = []
    for v in items:
        key = v if isinstance(v, str) else v.get("version") if isinstance(v, dict) else None
        if not isinstance(key, str) or not re.fullmatch(r"\d{14}", key):
            raise ValueError(f"Unexpected remote migration version: {v!r}")
        versions.append(key)
    if len(set(versions)) != len(versions):
        raise ValueError("Duplicate versions in remote history")
    if not versions:
        raise ValueError("Empty remote history")
    return set(versions)


def check_remote_match(entries, remote):
    local = set(entries)
    remote_tip = max(remote)
    new = {v for v, suffix in entries.items() if suffix in M2_SUFFIXES}
    missing_from_local = sorted(remote - local)
    earlier_unapplied = sorted(v for v in local - remote if v <= remote_tip)
    not_newer = sorted(v for v in new if v <= remote_tip)
    if missing_from_local or earlier_unapplied or not_newer:
        raise ValueError(
            "PRODUCTION RELEASE BLOCKED: migration history mismatch.\n"
            f"Remote entries missing locally ({len(missing_from_local)}): {missing_from_local}\n"
            f"Historical local entries absent remotely ({len(earlier_unapplied)}): {earlier_unapplied}\n"
            f"Proposed M2 versions no longer newer than live tip ({len(not_newer)}): {not_newer}\n"
            "Reconcile deployment history and validate a real-schema clone; "
            "do NOT silently use --include-all or migration repair."
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--remote-history", type=Path,
        help="Fresh read-only export of remote Supabase migration versions"
    )
    opts = parser.parse_args()
    try:
        entries = migration_versions()
        ordered = check_order(entries)
        print(
            f"M2 sequence: {len(ordered)} distinct additive migrations strictly "
            f"after recorded production tip {RECORDED_PRODUCTION_TIP}."
        )
        if opts.remote_history is None:
            print(
                "NOT A PRODUCTION RELEASE CERTIFICATE: remote migration history "
                "was not supplied."
            )
            return 0
        remote = extract_remote_versions(
            json.loads(opts.remote_history.read_text(encoding="utf-8"))
        )
        check_remote_match(entries, remote)
        print(f"Remote history matches all {len(remote)} deployed versions.")
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
