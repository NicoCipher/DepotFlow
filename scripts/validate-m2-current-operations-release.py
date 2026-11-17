#!/usr/bin/env python3
"""Validate the current 132-entry production ledger and applied Walnik sources.

This is an offline provenance check only. It does not connect to production,
apply migrations, repair history, enable gates, or authorize a release.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "supabase/tests/fixtures/production_migration_history_20261117_readonly.json"
SOURCE_LOCK = ROOT / "supabase/tests/fixtures/m2_forward_only_sources_20261019.json"
MIGRATIONS = ROOT / "supabase/migrations"

LIVE_COUNT = 132
LIVE_TIP = "20261117095151"
APPLIED_AFTER_PHASE_A = [
    ("20261029170523", "restore_authenticated_onboarding_rpc_grants_keep_gates_closed",
     "20261029170523_restore_authenticated_onboarding_rpc_grants_keep_gates_closed.sql"),
    ("20261104172806", "20261029180000_scope_product_writes_to_business_owner",
     "20261029180000_scope_product_writes_to_business_owner.sql"),
    ("20261104172847", "20261030100000_revoke_client_maintenance_privileges",
     "20261030100000_revoke_client_maintenance_privileges.sql"),
    ("20261115200016", "stage_tenant_customer_payments",
     "20261115200016_stage_tenant_customer_payments.sql"),
    ("20261115200023", "stage_operator_business_invitations",
     "20261115200023_stage_operator_business_invitations.sql"),
    ("20261115200028", "stage_tenant_business_sales",
     "20261115200028_stage_tenant_business_sales.sql"),
    ("20261115200035", "validate_tenant_foreign_keys",
     "20261115200035_validate_tenant_foreign_keys.sql"),
    ("20261117095142", "allow_active_tenant_customer_registration",
     "20261117010000_allow_active_tenant_customer_registration.sql"),
    ("20261117095147", "stage_business_opening_activation",
     "20261117020000_stage_business_opening_activation.sql"),
    ("20261117095149", "stage_tenant_stock_receiving_ui",
     "20261117030000_stage_tenant_stock_receiving_ui.sql"),
    ("20261117095151", "grant_authenticated_tenant_owner_rpcs",
     "20261117040000_grant_authenticated_tenant_owner_rpcs.sql"),
]
STAGED_OPERATIONS: list[str] = []
STAMP = re.compile(r"^(\d{14})_[a-z][a-z0-9_]*\.sql$")


def git_blob_sha1(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(
        b"blob " + str(len(data)).encode("ascii") + b"\0" + data
    ).hexdigest()


def validate() -> dict:
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))

    if snapshot.get("purpose") != "READ-ONLY PRODUCTION MIGRATION LEDGER SNAPSHOT; NOT RELEASE APPROVAL":
        raise ValueError("Current ledger snapshot purpose is missing or unsafe")
    if snapshot.get("project_id") != "coyivbklakhilpcqqrzg":
        raise ValueError("Current ledger snapshot belongs to an unexpected project")
    if snapshot.get("release_authorized") is not False:
        raise ValueError("Read-only current ledger snapshot must not authorize production release")
    versions = snapshot.get("versions")
    names = snapshot.get("names")
    if not isinstance(versions, list) or not isinstance(names, dict):
        raise ValueError("Current ledger snapshot is missing versions or names")
    if snapshot.get("count") != LIVE_COUNT or len(versions) != LIVE_COUNT:
        raise ValueError(f"Expected exactly {LIVE_COUNT} production migration records")
    if snapshot.get("live_tip") != LIVE_TIP or versions[-1] != LIVE_TIP:
        raise ValueError("Current production migration tip differs from the reviewed 128-entry snapshot")
    if len(set(versions)) != LIVE_COUNT or versions != sorted(versions):
        raise ValueError("Production migration versions are duplicated or out of order")
    if set(names) != set(versions) or any(not isinstance(names[v], str) or not names[v] for v in versions):
        raise ValueError("Production migration names do not exactly cover the recorded versions")

    for version, expected_name, _source in APPLIED_AFTER_PHASE_A:
        if names.get(version) != expected_name:
            raise ValueError(f"Unexpected production migration name at {version}")

    exclusions = lock.get("reviewed_excluded_sources")
    if not isinstance(exclusions, list):
        raise ValueError("Reviewed excluded-source lock is missing")
    pinned = {}
    for item in exclusions:
        if not isinstance(item, dict):
            raise ValueError("Malformed excluded-source lock entry")
        filename = item.get("filename")
        blob = item.get("git_blob_sha1")
        reason = item.get("reason")
        if not isinstance(filename, str) or not isinstance(blob, str) or not isinstance(reason, str) or not reason.strip():
            raise ValueError("Incomplete excluded-source lock entry")
        if filename in pinned:
            raise ValueError("Duplicate excluded-source lock entry: " + filename)
        pinned[filename] = (blob, reason)

    replay_sources = [source for _version, _name, source in APPLIED_AFTER_PHASE_A]
    expected_files = replay_sources + STAGED_OPERATIONS
    for filename in expected_files:
        path = MIGRATIONS / filename
        if not path.is_file():
            raise ValueError("Missing current-schema or staged migration source: " + filename)
        if filename not in pinned:
            raise ValueError("Migration source is not explicitly pinned as reviewed/excluded: " + filename)
        actual_blob = git_blob_sha1(path)
        expected_blob, _reason = pinned[filename]
        if actual_blob != expected_blob:
            raise ValueError("Pinned migration source changed: " + filename)

    staged_versions = []
    for filename in STAGED_OPERATIONS:
        match = STAMP.fullmatch(filename)
        if not match:
            raise ValueError("Unsafe staged migration filename: " + filename)
        version = match.group(1)
        if version <= LIVE_TIP:
            raise ValueError("Staged migration does not follow the current live tip: " + filename)
        staged_versions.append(version)
    if staged_versions != sorted(set(staged_versions)):
        raise ValueError("Staged operations migrations are not in strict dependency/version order")

    unaccounted = []
    for path in MIGRATIONS.glob("*.sql"):
        match = STAMP.fullmatch(path.name)
        if match and match.group(1) > LIVE_TIP and path.name not in STAGED_OPERATIONS:
            unaccounted.append(path.name)
    if unaccounted:
        raise ValueError("Unreviewed migrations newer than the live production tip: " + repr(sorted(unaccounted)))

    return {
        "production_migration_count": LIVE_COUNT,
        "production_live_tip": LIVE_TIP,
        "post_phase_a_applied_sources": len(APPLIED_AFTER_PHASE_A),
        "staged_operations_sources": len(STAGED_OPERATIONS),
        "staged_operations": STAGED_OPERATIONS,
        "release_authorized": False,
    }


def main() -> int:
    try:
        result = validate()
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print("CURRENT OPERATIONS RELEASE BLOCKED: " + str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    print("REHEARSAL ONLY: obtain explicit release approval before any production change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
