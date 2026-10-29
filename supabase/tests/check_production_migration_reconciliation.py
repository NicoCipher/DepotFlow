#!/usr/bin/env python3
"""Validate the current read-only production ledger against reviewed M2 source aliases.

This is a repository-side check only. It never connects to Supabase, repairs
migration history, or certifies byte-for-byte production SQL equivalence.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
CURRENT = ROOT / "tests/fixtures/production_migration_history_20261029_after_m2_phase_a.json"
PREVIOUS = ROOT / "tests/fixtures/production_migration_history_20261019_after_auth.json"
LOCK = ROOT / "tests/fixtures/m2_forward_only_sources_20261019.json"
MANIFEST = REPO / "docs/release-evidence/production-migration-reconciliation-20261029.json"
MIGRATIONS = ROOT / "migrations"
STAMP = re.compile(r"^\d{14}$")
FILENAME = re.compile(r"^(\d{14})_([a-z][a-z0-9_]*)\.sql$")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def validate():
    live = read(CURRENT)
    previous = read(PREVIOUS)
    lock = read(LOCK)
    manifest = read(MANIFEST)
    versions = live.get("versions")
    names = live.get("names")
    if not isinstance(versions, list) or len(versions) != 121:
        raise ValueError("Current production snapshot must contain exactly 121 ledger entries")
    if versions != sorted(set(versions)) or any(not isinstance(v, str) or not STAMP.fullmatch(v) for v in versions):
        raise ValueError("Current production versions are malformed, duplicated, or unordered")
    if not isinstance(names, dict) or set(names) != set(versions):
        raise ValueError("Every live migration version must have exactly one recorded name")
    if live.get("live_tip") != versions[-1] or versions[-1] != "20261019140104":
        raise ValueError("Current live tip changed; refresh and review the snapshot before release")
    if manifest.get("current_tip") != versions[-1] or manifest.get("counts", {}).get("total_live") != len(versions):
        raise ValueError("Reconciliation manifest disagrees with the current snapshot")
    if manifest.get("status") != "ledger_reconciled_schema_and_applied_sql_provenance_not_fully_certified":
        raise ValueError("Reconciliation status must preserve the applied-SQL/schema caveat")

    findings = manifest.get("findings", {})
    if findings.get("legacy_write_scope_enabled") is not False:
        raise ValueError("Legacy write-scope gate changed; re-review owner/business isolation")
    if findings.get("new_business_registration_enabled") is not False \
       or findings.get("business_selection_enabled") is not False:
        raise ValueError("Business activation gates changed; re-review release order")
    if findings.get("authenticated_direct_insert_product_available") is not True \
       or findings.get("authenticated_legacy_create_rpcs_available") is not True:
        raise ValueError("Legacy app creation path changed; separately review Phase B cutover")
    if findings.get("client_maintenance_grants_present") is not True:
        raise ValueError("Client maintenance grant baseline changed; re-review the hardening migration")
    order = manifest.get("approved_release_order", {})
    if order.get("next_candidate") != "20261029103000_revoke_client_maintenance_privileges.sql":
        raise ValueError("Next forward migration changed; re-review release order")
    if order.get("following_candidate") != "20261029110000_stage_legacy_bulk_price_updates.sql":
        raise ValueError("Bulk-price migration order changed; re-review release sequence")
    if order.get("production_deployment", "").startswith("GO"):
        raise ValueError("Ledger reconciliation alone must never authorize production deployment")

    # The first 55 historical entries must remain byte-for-byte represented by
    # the prior ledger snapshot and historical SQL evidence. No repair/replay.
    if versions[:55] != previous.get("versions", [])[:55]:
        raise ValueError("The 55 historical production versions changed")
    for version in versions[:55]:
        if names[version] != previous.get("names", {}).get(version):
            raise ValueError("Historical production migration name changed: " + version)

    # Hosted Auth gate is the existing 56th migration, not a source to replay.
    auth_version = versions[55]
    if auth_version != "20261019132131" or names[auth_version] != "depotflow_hosted_auth_signup_closed_guard_20261019":
        raise ValueError("Hosted Auth migration alias/order changed")
    if lock.get("already_applied_auth_source") != "20261018112000_stage_auth_side_signup_hook.sql":
        raise ValueError("Auth source lock changed")

    sources = lock.get("source_migrations")
    if not isinstance(sources, list) or len(sources) != 66:
        raise ValueError("Reviewed M2 source lock must have 65 Phase A sources and 1 separate Phase B source")
    phase_a = sources[:65]
    phase_b = sources[65]
    live_phase_a = versions[56:]
    if len(live_phase_a) != 65:
        raise ValueError("Expected exactly 65 recorded M2 Phase A migrations")
    mapped = manifest.get("m2_phase_a", {}).get("source_to_live")
    if not isinstance(mapped, list) or len(mapped) != 65:
        raise ValueError("Reviewed 65-entry Phase A source mapping is missing")
    for index, (source, version, item) in enumerate(zip(phase_a, live_phase_a, mapped)):
        found = FILENAME.fullmatch(Path(source).name)
        if not found or not (MIGRATIONS / Path(source).name).is_file():
            raise ValueError("M2 source is missing or malformed: " + source)
        source_name = found.group(2)
        if names[version] != source_name:
            raise ValueError(f"M2 source/live name mismatch at stage {index}: {source_name} != {names[version]}")
        expected = {"version": version, "name": names[version], "source": source}
        if any(item.get(key) != value for key, value in expected.items()):
            raise ValueError("Reviewed Phase A mapping differs at stage " + str(index))
    if phase_b != "20261018124000_finalize_legacy_creation_api_cutover.sql":
        raise ValueError("Phase B source changed; require a separate cutover review")
    if any(name == "finalize_legacy_creation_api_cutover" for name in names.values()):
        raise ValueError("Phase B finalizer is unexpectedly recorded as applied")
    if manifest.get("phase_b", {}).get("applied") is not False:
        raise ValueError("Phase B must remain explicitly deferred")

    # Only migrations strictly newer than the actual live tip can be new
    # forward migrations. Older M2 source aliases are intentionally mapped
    # above; they must not be replayed under their source timestamps.
    local = {}
    for file in MIGRATIONS.glob("*.sql"):
        match = FILENAME.fullmatch(file.name)
        if not match:
            raise ValueError("Malformed local migration filename: " + file.name)
        version, name = match.groups()
        if version in local:
            raise ValueError("Duplicate local migration version: " + version)
        local[version] = name
    pending = sorted((version, name) for version, name in local.items() if version > versions[-1])
    expected_pending = [
        ("20261029103000", "revoke_client_maintenance_privileges"),
        ("20261029110000", "stage_legacy_bulk_price_updates"),
    ]
    if pending != expected_pending:
        raise ValueError("Pending forward migration inventory changed: " + repr(pending))
    if pending[0][0] <= versions[-1]:
        raise ValueError("Bulk price migration must be strictly after the live tip")
    if manifest.get("findings", {}).get("bulk_price_rpc_exists") is not False:
        raise ValueError("Expected the new bulk price RPC to be absent before migration")

    return {
        "live_count": len(versions),
        "live_tip": versions[-1],
        "historical_count": 55,
        "auth_count": 1,
        "m2_phase_a_count": len(live_phase_a),
        "phase_b_applied": False,
        "pending_forward_migrations": [f"{v}_{n}.sql" for v, n in pending],
    }


if __name__ == "__main__":
    try:
        result = validate()
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print("PRODUCTION RELEASE BLOCKED: " + str(exc), file=sys.stderr)
        raise SystemExit(2)
    print("LEDGER RECONCILIATION PASS (not a schema/applied-SQL release certificate):")
    print(json.dumps(result, indent=2))
