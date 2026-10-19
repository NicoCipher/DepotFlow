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
HISTORY_SNAPSHOT = ROOT / "supabase/tests/fixtures/production_migration_history_20261018.json"
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
            "BLOCKED: production migration ledger changed from the reviewed 55-entry snapshot; "
            "obtain a fresh read-only ledger and re-review the release plan"
        )
    if set(x["version"] for x in evidence["entries"]) != set(expected) or len(evidence["entries"]) != len(expected):
        raise ValueError("BLOCKED: applied SQL provenance does not match recorded ledger")
    if remote.get("names") is not None and remote["names"] != snapshot["names"]:
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

    sources = lock["source_migrations"]
    if len(sources) != 67 or len(set(sources)) != 67 or sources != sorted(sources):
        raise ValueError("BLOCKED: expected 67 unique ordered M2 migration sources")
    final = "20261018124000_finalize_legacy_creation_api_cutover.sql"
    if sources[-1] != final or final in sources[:-1]:
        raise ValueError("BLOCKED: Phase B finalizer must be separate and last")
    if lock["phase_a_count"] != 66 or lock["phase_b_count"] != 1:
        raise ValueError("BLOCKED: migration phase inventory drift")

    # An added M2 source cannot be silently skipped by a previously locked
    # release list. Historical local candidates must not be replayed either.
    source_set = set(sources)
    historic_candidates = {x.get("localCandidate") for x in evidence["entries"]}
    candidate_files = {p.name for p in MIGRATIONS.glob("*.sql")}
    unreviewed = sorted(
        name for name in candidate_files - source_set - historic_candidates
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
        phase = "phase-b" if index == 66 else "phase-a"
        target = version + "_" + FILENAME.fullmatch(source_name).group(2) + ".sql"
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
            header = (
                "-- FORWARD-ONLY REHEARSAL ARTIFACT. NOT APPROVED FOR PRODUCTION.\n"
                + "-- Source: " + item["source"] + "\n"
                + "-- Source SHA256: " + item["source_sha256"] + "\n"
            ).encode("ascii")
            (dest / item["filename"]).write_bytes(header + original)
        (output / "release-manifest.json").write_text(
            json.dumps({
                "production_release_authorized": False,
                "reconstructed_history_only": True,
                "baseline": snapshot["live_tip"],
                "baseline_count": len(history),
                "phase_a_count": 66,
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
