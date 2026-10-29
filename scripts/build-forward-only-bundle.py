#!/usr/bin/env python3
"""Build a REHEARSAL-ONLY, forward-versioned Phase A SQL bundle.

This never contacts Supabase and deliberately does not package the Phase B
legacy API revocation. A new, current live migration-ledger comparison,
actual schema/grant parity, approval, and production backup are still needed
before anyone may prepare a production release.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "docs/m2-forward-only-release-inventory-20261019.json"
SNAPSHOT = ROOT / "supabase/tests/fixtures/production_migration_history_20261019_after_auth.json"
HISTORY_SQL = ROOT / "docs/m2-applied-sql-reconciliation-manifest-20261019.json"
PATTERN = re.compile(r"supabase/migrations/(\d{14})_([a-z][a-z0-9_]*)\.sql\Z")
STAMP = "%Y%m%d%H%M%S"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_history(fresh: dict, pinned: dict, evidence: dict, inventory: dict):
    """Fail closed on ANY ledger change, including names and order."""
    expected = pinned.get("versions")
    names = pinned.get("names")
    if not isinstance(expected, list) or len(expected) != 56 or expected != sorted(set(expected)):
        raise ValueError("Pinned production history is not 56 strictly ordered versions")
    if not isinstance(names, dict) or set(names) != set(expected):
        raise ValueError("Pinned production migration names missing or altered")
    if pinned.get("live_tip") != expected[-1] or expected[-1] != inventory["expected_live_tip"]:
        raise ValueError("Pinned production tip mismatch")
    if inventory["expected_applied_migrations"] != 56:
        raise ValueError("Unexpected expected production migration count")
    if fresh.get("versions") != expected or fresh.get("names") != names:
        raise ValueError("PRODUCTION RELEASE BLOCKED: current ledger differs from frozen 56-version and name baseline")
    entries = evidence.get("entries")
    locked = json.loads(
        (ROOT / "supabase/tests/fixtures/m2_forward_only_sources_20261019.json").read_text(encoding="utf-8")
    ).get("applied_sql_provenance")
    if not isinstance(locked, list) or len(locked) != 55 or entries != locked:
        raise ValueError("Applied SQL provenance candidate/name/status mapping differs from locked evidence")
    if [(r.get("version"), r.get("name")) for r in entries] != [
        (v, names[v]) for v in expected[:55]
    ]:
        raise ValueError("Applied SQL evidence names/order mismatch actual pinned production ledger")
    # Multiple applied migrations may legitimately reference the SAME local
    # SQL candidate (e.g. sale/receipt upgrades). The exact per-row reviewed
    # provenance lock above, not candidate uniqueness, enforces identity.
    if evidence.get("release_authorized") is not False or inventory.get("release_authorized") is not False:
        raise ValueError("Release inventory/evidence must not authorize production")
    return expected[-1]


def validate_sources(root: Path, inventory: dict, live_tip: str, compare_ref=None):
    if inventory.get("format") != "depotflow-forward-only-precutover-rehearsal-v1":
        raise ValueError("Unknown release inventory format")
    if inventory.get("phase_a_version_start") != "20261019140000" or inventory.get("version_interval_seconds") != 1:
        raise ValueError("Version assignment changed; require separate review")
    stages = inventory.get("phase_a_source_migrations")
    post = inventory.get("phase_b_separately_authorized_source")
    if not isinstance(stages, list) or len(stages) != 65 or not isinstance(post, str):
        raise ValueError("Expected exactly 65 Phase A migrations and 1 independent Phase B migration")
    all_sources = stages + [post]
    if len(set(all_sources)) != 66 or all_sources != sorted(all_sources):
        raise ValueError("Migration release inventory must be unique and in original dependency order")
    if post != "supabase/migrations/20261018124000_finalize_legacy_creation_api_cutover.sql":
        raise ValueError("Unsafe attempt to mix Phase B with database-first staging")
    # Keep the previously reviewed 67-file full-phase source lock and this
    # Phase A-only inventory on EXACTLY the same source/version mapping.
    locked = json.loads(
        (root / "supabase/tests/fixtures/m2_forward_only_sources_20261019.json").read_text(encoding="utf-8")
    )
    if locked.get("source_migrations") != [p.split("/")[-1] for p in all_sources] \
       or locked.get("base_version_utc") != inventory["phase_a_version_start"] \
       or locked.get("phase_a_count") != 65 or locked.get("phase_b_count") != 1 \
       or locked.get("phase_b_target_filename", "MISSING") is not None \
       or locked.get("already_applied_auth_source") != inventory.get("already_applied_auth_source", "").split("/")[-1]:
        raise ValueError("Conflicting forward-only release inventories or version bases")
    preinstalled = inventory.get("already_applied_auth_source")
    if preinstalled != "supabase/migrations/20261018112000_stage_auth_side_signup_hook.sql" \
       or preinstalled in all_sources:
        raise ValueError("Auth migration already installed in production must NOT replay in Phase A")
    if any(PATTERN.fullmatch(p) is None for p in all_sources):
        raise ValueError("Nonmigration or unsafe release source path")
    if any(not (root / p).is_file() for p in all_sources):
        raise ValueError("Missing source SQL migration")
    if compare_ref:
        cp = subprocess.run(
            ["git", "-C", str(root), "diff", "--name-status",
             compare_ref, "HEAD", "--", "supabase/migrations/"],
            check=True, capture_output=True, text=True,
        )
        found = set()
        modified = []
        unsupported_changes = []
        for line in cp.stdout.splitlines():
            fields = line.split("\t")
            status = fields[0]
            if status == "A" and len(fields) == 2:
                found.add(fields[1])
            elif status == "M" and len(fields) == 2:
                modified.append(fields[1])
            else:
                # Deletions, renames, copies, type changes and malformed
                # status records are not safe release-inventory changes.
                unsupported_changes.append(line)
        if modified:
            raise ValueError(
                "RELEASE INVENTORY DRIFT: existing migration source files were modified; "
                f"reviewed sources must remain byte-identical: {sorted(modified)}"
            )
        if unsupported_changes:
            raise ValueError(
                "RELEASE INVENTORY DRIFT: migration deletions, renames, or other non-additive "
                f"changes are not permitted: {unsupported_changes}"
            )

        # The 65 Phase A sources and the already-installed Auth source are a
        # reviewed inventory, not a promise that all 67 must be newly added
        # relative to every PR base. Once those historical files exist on the
        # comparison branch, --name-status correctly omits them. Require
        # every newly added migration to be accounted for by either the
        # reviewed release inventory or an explicit, hash-locked exclusion.
        excluded = locked.get("reviewed_excluded_sources")
        if not isinstance(excluded, list):
            raise ValueError("Missing reviewed exclusions for migrations outside the historical rehearsal bundle")
        excluded_paths = set()
        excluded_hashes = {}
        for item in excluded:
            if not isinstance(item, dict):
                raise ValueError("Malformed reviewed migration exclusion")
            filename = item.get("filename")
            blob_sha = item.get("git_blob_sha1")
            if not isinstance(filename, str) or not re.fullmatch(r"\d{14}_[a-z][a-z0-9_]*\.sql", filename):
                raise ValueError("Unsafe reviewed migration exclusion filename")
            if not isinstance(blob_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", blob_sha):
                raise ValueError("Missing reviewed Git blob SHA for excluded migration")
            path = "supabase/migrations/" + filename
            if path in excluded_paths or path in all_sources or path == preinstalled:
                raise ValueError("Duplicate or conflicting reviewed migration exclusion")
            excluded_paths.add(path)
            excluded_hashes[path] = blob_sha

        allowed_added = set(all_sources + [preinstalled]) | excluded_paths
        unexpected = sorted(found - allowed_added)
        if unexpected:
            raise ValueError(
                "RELEASE INVENTORY DRIFT: newly added SQL migrations are not in the reviewed release inventory "
                "or hash-locked exclusions; "
                f"unexpected={unexpected}"
            )
        for path in sorted(found & excluded_paths):
            actual_blob = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD:" + path],
                check=True, capture_output=True, text=True,
            ).stdout.strip()
            if actual_blob != excluded_hashes[path]:
                raise ValueError(
                    "RELEASE INVENTORY DRIFT: reviewed excluded migration content changed: " + path
                )
    start = datetime.strptime(inventory["phase_a_version_start"], STAMP)
    versions = [(start + timedelta(seconds=i * 1)).strftime(STAMP) for i in range(len(stages))]
    if versions[0] <= live_tip or versions != sorted(set(versions)):
        raise ValueError("Forward-only assigned versions are not unique or strictly after recorded live tip")
    canonical = locked.get("canonical_phase_a_target_filenames")
    if not isinstance(canonical, list) or len(canonical) != 65 or len(set(canonical)) != 65:
        raise ValueError("Missing 65 unique canonical Phase A migration filenames")
    for i, (source, version) in enumerate(zip(stages, versions)):
        suffix = PATTERN.fullmatch(source).group(2)
        if canonical[i] != f"{version}_{suffix}.sql":
            raise ValueError("Canonical migration filename mismatch: reviewed Phase A target differs")
    existing = {p.name[:14] for p in (root / "supabase/migrations").glob("*.sql")}
    if existing.intersection(versions):
        raise ValueError("Generated migration version collides with an existing repository migration")
    return stages, versions


def build_bundle(root: Path, inventory: dict, actual: dict, pinned: dict,
                 evidence: dict, out: Path, compare_ref=None):
    live_tip = validate_history(actual, pinned, evidence, inventory)
    stages, versions = validate_sources(root, inventory, live_tip, compare_ref)
    out = out.resolve()
    if out == root.resolve() or root.resolve() in out.parents:
        raise ValueError("Rehearsal output must be outside the repository")
    if out.exists():
        raise ValueError("Output directory already exists: refusing to overwrite a reviewed bundle")
    # Complete validation before writing any SQL to disk.
    files = []
    for i, (source, version) in enumerate(zip(stages, versions), start=1):
        payload = (root / source).read_bytes()
        if not payload.strip() or b"\\x00" in payload:
            raise ValueError("Empty or binary migration source: " + source)
        suffix = PATTERN.fullmatch(source).group(2)
        new_name = f"{version}_{suffix}.sql"
        files.append((source, new_name, payload))
    out.mkdir(parents=True, exist_ok=False)
    audit = {
        "purpose": "DISPOSABLE DATABASE REHEARSAL ONLY - NOT PRODUCTION APPROVAL",
        "live_history_snapshot_count": 56,
        "live_history_tip": live_tip,
        "phase_a_count": 65,
        "phase_b_excluded": inventory["phase_b_separately_authorized_source"],
        "sql_changed": False,
        "files": [],
    }
    for source, name, payload in files:
        (out / name).write_bytes(payload)
        audit["files"].append({
            "source": source,
            "staged": name,
            "sha256_original_and_staged": digest(payload),
        })
    # Store manifest one directory ABOVE generated SQL; SQL glob only sees migrations.
    (out.parent / (out.name + "-rehearsal-audit.json")).write_text(
        json.dumps(audit, indent=2) + "\n", encoding="utf-8"
    )
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--remote-history", required=True, type=Path,
                        help="Read-only ledger JSON; historical CI fixture is rehearsal ONLY")
    parser.add_argument("--compare-ref", help="Git base/ref to verify exact added-migration inventory")
    args = parser.parse_args()
    try:
        manifest = json.loads(INVENTORY.read_text(encoding="utf-8"))
        pinned = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        evidence = json.loads(HISTORY_SQL.read_text(encoding="utf-8"))
        actual = json.loads(args.remote_history.read_text(encoding="utf-8"))
        audit = build_bundle(ROOT, manifest, actual, pinned, evidence,
                             args.out.resolve(), args.compare_ref)
        print(f"REHEARSAL ONLY: generated {audit['phase_a_count']} forward-only Phase A SQL stages "
              f"after frozen {audit['live_history_tip']} history; Phase B excluded.")
        print("NOT a production release certificate: verify fresh live ledger, actual schema/grants, "
              "hosted Auth, backup, and obtain explicit approval. DO NOT db push.")
    except (ValueError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as e:
        print("PRODUCTION RELEASE BLOCKED: " + str(e), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
