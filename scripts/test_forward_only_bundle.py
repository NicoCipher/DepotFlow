"""Fail-closed regressions for the sandbox-only forward-versioned Phase A planner."""
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "forward_only", ROOT / "scripts/build-forward-only-bundle.py"
)
forward = importlib.util.module_from_spec(spec)
spec.loader.exec_module(forward)


class ForwardOnlyRehearsalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = json.loads(forward.INVENTORY.read_text(encoding="utf-8"))
        cls.history = json.loads(forward.SNAPSHOT.read_text(encoding="utf-8"))
        cls.evidence = json.loads(forward.HISTORY_SQL.read_text(encoding="utf-8"))

    def plan(self, inventory=None, history=None, evidence=None):
        inv = copy.deepcopy(inventory if inventory is not None else self.inventory)
        remote = copy.deepcopy(history if history is not None else self.history)
        ev = copy.deepcopy(evidence if evidence is not None else self.evidence)
        tip = forward.validate_history(remote, self.history, ev, inv)
        return forward.validate_sources(ROOT, inv, tip)

    def test_exact_55_live_versions_and_names_and_all_source_files(self):
        files, versions = self.plan()
        self.assertEqual(len(files), 66)
        self.assertEqual(len(set(versions)), 66)
        self.assertEqual(versions[0], "20261019000000")
        self.assertEqual(versions[-1], "20261019010500")
        self.assertTrue(all(version > self.history["live_tip"] for version in versions))
        self.assertNotIn(self.inventory["phase_b_separately_authorized_source"], files)

    def test_generate_only_old_app_compatible_phase_a_sql_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "phase-a"
            audit = forward.build_bundle(
                ROOT, self.inventory, self.history, self.history, self.evidence, out
            )
            actual = sorted(out.glob("*.sql"))
            self.assertEqual(len(actual), 66)
            self.assertEqual(len(audit["files"]), 66)
            self.assertFalse(any("finalize_legacy_creation_api_cutover" in f.name for f in actual))
            for row in audit["files"]:
                original = (ROOT / row["source"]).read_bytes()
                built = (out / row["staged"]).read_bytes()
                self.assertEqual(original, built)
                self.assertEqual(row["sha256_original_and_staged"], forward.digest(built))
            self.assertTrue((Path(directory) / "phase-a-rehearsal-audit.json").is_file())
            with self.assertRaisesRegex(ValueError, "already exists"):
                forward.build_bundle(
                    ROOT, self.inventory, self.history, self.history, self.evidence, out
                )

    def test_added_or_renamed_remote_version_blocks(self):
        changed = copy.deepcopy(self.history)
        changed["versions"].append("20261018100000")
        changed["names"]["20261018100000"] = "other"
        with self.assertRaisesRegex(ValueError, "PRODUCTION RELEASE BLOCKED"):
            self.plan(history=changed)
        changed = copy.deepcopy(self.history)
        changed["names"][changed["live_tip"]] = "renamed_while_not_reconciled"
        with self.assertRaisesRegex(ValueError, "PRODUCTION RELEASE BLOCKED"):
            self.plan(history=changed)

    def test_corrupt_historical_manifest_blocks(self):
        changed = copy.deepcopy(self.evidence)
        changed["entries"][0]["name"] = "wrong_name"
        with self.assertRaisesRegex(ValueError, "evidence"):
            self.plan(evidence=changed)

    def test_attempted_cutover_in_phase_a_blocks(self):
        changed = copy.deepcopy(self.inventory)
        changed["phase_a_source_migrations"][-1] = changed[
            "phase_b_separately_authorized_source"
        ]
        with self.assertRaises(ValueError):
            self.plan(inventory=changed)

    def test_stage_inventory_drift_or_duplicate_blocks(self):
        changed = copy.deepcopy(self.inventory)
        changed["phase_a_source_migrations"].pop()
        with self.assertRaisesRegex(ValueError, "exactly 66"):
            self.plan(inventory=changed)
        changed = copy.deepcopy(self.inventory)
        changed["phase_a_source_migrations"][1] = changed[
            "phase_a_source_migrations"
        ][0]
        with self.assertRaisesRegex(ValueError, "unique"):
            self.plan(inventory=changed)

    def test_release_authorization_inside_manifest_blocks(self):
        changed = copy.deepcopy(self.inventory)
        changed["release_authorized"] = True
        with self.assertRaisesRegex(ValueError, "must not authorize"):
            self.plan(inventory=changed)

    def test_earlier_or_colliding_reversions_block(self):
        changed = copy.deepcopy(self.inventory)
        changed["phase_a_version_start"] = "20261016000000"
        with self.assertRaisesRegex(ValueError, "Version assignment"):
            self.plan(inventory=changed)

    def test_missing_source_blocks(self):
        changed = copy.deepcopy(self.inventory)
        changed["phase_a_source_migrations"][0] = (
            "supabase/migrations/20261016020000_nonexistent_file.sql"
        )
        with self.assertRaises(ValueError):
            self.plan(inventory=changed)


if __name__ == "__main__":
    unittest.main()
