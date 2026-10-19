#!/usr/bin/env python3
"""Generate an isolated, forward-only M2 migration rehearsal bundle.

This tool NEVER contacts production, repairs migration history or applies SQL.
It intentionally refuses any remote-version drift and writes exclusively
outside the Git repository. Outputs are unapproved review artifacts.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE_LOCK = ROOT / "supabase/tests/fixtures/m2_forward_only_sources_20261019.json"
HISTORY_SNAPSHOT = ROOT / "supabase/tests/fixtures/production_migration_history_20261019_after_auth.json"
APPLIED_EVIDENCE = ROOT / "docs/m2-applied-sql-reconciliation-manifest-20261019.json"
MIGRATIONS = ROOT / "supabase/migrations"
FILENAME = re.compile(r"(\d{14})_([a-z][a-z0-9_]*)\.sql")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def validate_remote(remote, snapshot, evidence):
    expected = snapshot["versions"]
    actual = remote.get("versions")
    if not isinstance(actual, list) or not actual or any(
        not isinstance(x, str) or re.fullmatch(r"\d{14}", x) is None for x in actual
    ) or len(set(actual)) != len(actual):
        raise ValueError("BLOCKED: missing, malformed or duplicate remote migration versions")
    if len(set(expected)) != len(expected):
        raise ValueError("BLOCKED: corrupt recorded production history")
    if actual != expected:
        raise ValueError(
            "BLOCKED: production migration ledger changed from the reviewed 56-entry snapshot; "
            "obtain a fresh read-only ledger and re-review the release plan"
        )
    # Exact SQL provenance is a release boundary, not merely a set of
    # historical version numbers. Match the applied ledger's ORDERED names
    # and the separately reviewed status/localCandidate/archive mapping.
    # Otherwise an M2 source could be mislabeled as an applied historical
    # candidate and silently excluded from the forward-only package.
    locked = read_json(SOURCE_LOCK).get("applied_sql_provenance")
    entries = evidence.get("entries")
    if not isinstance(locked, list) or len(locked) != 55 or entries != locked:
        raise ValueError("BLOCKED: historical SQL provenance mapping changed from reviewed lock")
    if [(item.get("version"), item.get("name")) for item in entries] != [
        (version, snapshot["names"][version]) for version in expected[:55]
    ]:
        raise ValueError("BLOCKED: historical SQL provenance names/order do not match production ledger")
    candidates = [item["localCandidate"] for item in entries if item.get("localCandidate")]
    if len(candidates) != len(set(candidates)):
        raise ValueError("BLOCKED: duplicated historical SQL source provenance")
    if remote.get("names") is None or remote["names"] != snapshot["names"]:
        raise ValueError("BLOCKED: remote migration labels differ from recorded history")
    if max(expected) != snapshot["live_tip"]:
        raise ValueError("BLOCKED: recorded ledger tip does not match its versions")
    if evidence["release_authorized"] is not False:
        raise ValueError("BLOCKED: historical evidence must not claim release approval")
    return expected


def build(remote_path, out_dir=None):
    lock = read_json(SOURCE_LOCK)
    snapshot = read_json(HISTORY_SNAPSHOT)
    evidence = read_json(APPLIED_EVIDENCE)
    actual_remote = read_json(remote_path)
    history = validate_remote(actual_remote, snapshot, evidence)

    if lock.get("already_applied_auth_source") != "20261018112000_stage_auth_side_signup_hook.sql" \
       or snapshot["names"].get(snapshot["live_tip"]) != "depotflow_hosted_auth_signup_closed_guard_20261019":
        raise ValueError("BLOCKED: actual installed Auth migration not recognized")
    sources = lock["source_migrations"]
    if len(sources) != 66 or len(set(sources)) != 66 or sources != sorted(sources):
        raise ValueError("BLOCKED: expected 66 unique ordered remaining M2 migration sources")
    final = "20261018124000_finalize_legacy_creation_api_cutover.sql"
    if lock["already_applied_auth_source"] in sources:
        raise ValueError("BLOCKED: Auth SQL already installed in hosted production")
    if sources[-1] != final or final in sources[:-1]:
        raise ValueError("BLOCKED: Phase B finalizer must be separate and last")
    if lock["phase_a_count"] != 65 or lock["phase_b_count"] != 1:
        raise ValueError("BLOCKED: migration phase inventory drift")

    targets = lock.get("canonical_phase_a_target_filenames")
    if not isinstance(targets, list) or len(targets) != 65 or len(set(targets)) != 65 \
       or lock.get("phase_b_target_filename", "MISSING") is not None:
        raise ValueError("BLOCKED: 65 canonical Phase A target names required; no Phase B release name is authorized")
    phase_a_source_names = sources[:65]
    for index, (source, target) in enumerate(zip(phase_a_source_names, targets)):
        ver = (datetime.strptime(lock["base_version_utc"], "%Y%m%d%H%M%S")
               + timedelta(seconds=index)).strftime("%Y%m%d%H%M%S")
        expected_target = ver + "_" + FILENAME.fullmatch(source).group(2) + ".sql"
        if target != expected_target:
            raise ValueError("BLOCKED: canonical Phase A filename/source/version drift")

    # An added M2 source cannot be silently skipped by a previously locked
    # release list. Historical local candidates must not be replayed either.
    source_set = set(sources)
    historic_candidates = {x["localCandidate"] for x in lock["applied_sql_provenance"] if x.get("localCandidate")}
    if historic_candidates.intersection(source_set):
        raise ValueError("BLOCKED: historical SQL candidate overlaps tenant Phase A or cutover source")
    candidate_files = {p.name for p in MIGRATIONS.glob("*.sql")}
    unreviewed = sorted(
        name for name in candidate_files - source_set - historic_candidates - {lock["already_applied_auth_source"]}
        if name >= "20261016020000"
    )
    if unreviewed or any(name not in candidate_files for name in sources):
        raise ValueError(
            "BLOCKED: unreviewed/missing migration sources: "
            + repr({"unreviewed": unreviewed, "missing": sorted(source_set-candidate_files)})
        )
    for name in sources:
        match = FILENAME.fullmatch(name)
        if not match or match.group(1) in history:
            raise ValueError("BLOCKED: invalid or already-applied M2 source " + name)

    start = datetime.strptime(lock["base_version_utc"], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    stage = []
    for index, source_name in enumerate(sources):
        original = MIGRATIONS / source_name
        raw = original.read_bytes()
        version = (start + timedelta(seconds=index)).strftime("%Y%m%d%H%M%S")
        if version <= max(history) or version in history or version in {x["version"] for x in stage}:
            raise ValueError("BLOCKED: proposed forward-only version collides with recorded history")
        phase = "phase-b" if index == 65 else "phase-a"
        # Phase A names are single-sourced from the reviewed lock. Phase B
        # receives only a disposable TEST name; no production cutover filename
        # has been approved or reserved.
        target = targets[index] if phase == "phase-a" else \
            version + "_test_only_" + FILENAME.fullmatch(source_name).group(2) + ".sql"
        stage.append({
            "phase": phase, "source": source_name, "source_sha256": hashlib.sha256(raw).hexdigest(),
            "version": version, "filename": target
        })

    if out_dir is not None:
        output = out_dir.resolve()
        if output == ROOT or ROOT in output.parents:
            raise ValueError("BLOCKED: generated release output must not be inside the repository")
        if output.exists():
            raise ValueError("BLOCKED: output directory must not already exist (no stale bundle reuse)")
        output.mkdir(parents=True)
        for item in stage:
            dest = output / item["phase"]
            dest.mkdir(exist_ok=True)
            original = (MIGRATIONS / item["source"]).read_bytes()
            # Match the Phase A-only bundle BYTE-FOR-BYTE, not merely by
            # version number. Safety/audit metadata lives in JSON beside SQL.
            (dest / item["filename"]).write_bytes(original)
        (output / "release-manifest.json").write_text(
            json.dumps({
                "production_release_authorized": False,
                "reconstructed_history_only": True,
                "baseline": snapshot["live_tip"],
                "baseline_count": len(history),
                "phase_a_count": 65,
                "phase_b_count": 1,
                "source_lock_sha256": hashlib.sha256(SOURCE_LOCK.read_bytes()).hexdigest(),
                "entries": stage
            }, indent=2) + "\n", encoding="utf-8"
        )
    print(
        f"REHEARSAL ONLY: {len(history)} recorded applied versions; "
        f"{len(stage)-1} forward-only Phase A stages, 1 isolated Phase B finalizer "
        f"({stage[0]['version']}..{stage[-1]['version']}). "
        "NOT a live-schema, ledger-freshness or production-release certificate."
    )
    return stage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remote-history", type=Path, required=True,
                        help="read-only Supabase migration list JSON; never a live connection")
    parser.add_argument("--out-dir", type=Path, help="nonexistent external directory for rehearsal bundle")
    args = parser.parse_args()
    try:
        build(args.remote_history, args.out_dir)
    except (ValueError, KeyError, OSError, TypeError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
