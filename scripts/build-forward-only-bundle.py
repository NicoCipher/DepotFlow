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
             compare_ref, "--", "supabase/migrations/"],
            check=True, capture_output=True, text=True,
        )
        changes = [line.split("\t") for line in cp.stdout.splitlines() if line.strip()]
        unsafe = [line for line in changes if not line or line[0] != "A" or len(line) != 2]
        if unsafe:
            raise ValueError(
                "RELEASE INVENTORY DRIFT: existing migration source files were modified, deleted, "
                "renamed, copied, or type-changed: " + repr(unsafe)
            )
        found = {line[1] for line in changes}
        locked_exclusions = locked.get("reviewed_excluded_sources", [])
        exclusion_paths = {
            "supabase/migrations/" + item["filename"]: item["git_blob_sha1"]
            for item in locked_exclusions
        }
        expected = set(all_sources + [inventory["already_applied_auth_source"]])
        allowed = expected | set(exclusion_paths)
        if not found.issubset(allowed):
            raise ValueError(
                "RELEASE INVENTORY DRIFT: newly added SQL migrations are not in the reviewed inventory: "
                + repr(sorted(found-allowed))
            )
        for path in found & set(exclusion_paths):
            worktree_bytes = (root / path).read_bytes()
            blob = b"blob " + str(len(worktree_bytes)).encode("ascii") + b"\\0" + worktree_bytes
            if hashlib.sha1(blob).hexdigest() != exclusion_paths[path]:
                raise ValueError("RELEASE INVENTORY DRIFT: excluded migration content changed: " + path)
            committed = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD:" + path],
                check=True, capture_output=True, text=True,
            ).stdout.strip()
            if committed != exclusion_paths[path]:
                raise ValueError("RELEASE INVENTORY DRIFT: excluded migration content changed in HEAD: " + path)
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
