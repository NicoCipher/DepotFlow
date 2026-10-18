"""Unit regressions for the read-only live-history release block."""
import json
import unittest
from pathlib import Path

from check_live_migration_history import local_migrations, problems, remote_migrations

FIXTURE = Path(__file__).parent / "fixtures" / "production_migration_history_20261018.json"


class MigrationHistoryChecks(unittest.TestCase):
    def test_positive_exact_history_and_safe_new_files(self):
        local = {"20261017132742": "activated", "20261018123000": "future_change"}
        remote = {"20261017132742": "activated"}
        self.assertEqual(problems(local, remote), [])

    def test_missing_live_history_blocks_deployment(self):
        live = remote_migrations(json.loads(FIXTURE.read_text(encoding="utf8")))
        local = local_migrations()
        differences = problems(local, live)
        self.assertGreater(len(live), 0)
        self.assertTrue(differences)
        self.assertTrue(any("live versions absent locally" in issue for issue in differences))

    def test_historical_local_migration_is_blocked(self):
        issues = problems(
            {"20261017132742": "activated", "20261016100000": "never_deployed"},
            {"20261017132742": "activated"},
        )
        self.assertTrue(any("historical local" in issue for issue in issues))

    def test_renamed_same_version_is_blocked(self):
        issues = problems(
            {"20261017132742": "wrong"},
            {"20261017132742": "original"},
        )
        self.assertTrue(any("name mismatches" in issue for issue in issues))

    def test_duplicate_remote_versions_fail(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            remote_migrations({"versions": ["20261017132742", "20261017132742"]})

    def test_malformed_versions_fail(self):
        with self.assertRaisesRegex(ValueError, "Invalid remote"):
            remote_migrations({"versions": ["2026-10-17"]})


if __name__ == "__main__":
    unittest.main()
