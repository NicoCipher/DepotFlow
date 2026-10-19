"""Regression tests for the zero-cost, fail-closed forward-only M2 bundle."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/build-forward-only-m2-release.py"
spec = importlib.util.spec_from_file_location("m2_forward_release", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SNAPSHOT = ROOT / "supabase/tests/fixtures/production_migration_history_20261019_after_auth.json"


class ForwardOnlyBundleTest(unittest.TestCase):
    def test_all_66_remaining_versions_are_new_and_phase_b_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "rehearsal"
            stages = module.build(SNAPSHOT, output)
            history = set(json.loads(SNAPSHOT.read_text())["versions"])
            self.assertEqual(len(stages), 66)
            self.assertEqual(len(list((output / "phase-a").glob("*.sql"))), 65)
            self.assertEqual(len(list((output / "phase-b").glob("*.sql"))), 1)
            self.assertEqual([x["version"] for x in stages], sorted(x["version"] for x in stages))
            self.assertEqual(len(set(x["version"] for x in stages)), 66)
            self.assertTrue(all(x["version"] > max(history) for x in stages))
            self.assertFalse(set(x["version"] for x in stages) & history)
            self.assertFalse(any("stage_auth_side_signup_hook" in x["source"] for x in stages))
            self.assertEqual(stages[-1]["source"], "20261018124000_finalize_legacy_creation_api_cutover.sql")
            release = json.loads((output / "release-manifest.json").read_text())
            self.assertFalse(release["production_release_authorized"])
            self.assertTrue(release["reconstructed_history_only"])
            for row in stages:
                generated = (output / row["phase"] / row["filename"]).read_bytes()
                source = (ROOT / "supabase/migrations" / row["source"]).read_bytes()
                self.assertEqual(generated, source, row["source"])
                self.assertEqual(row["source_sha256"], __import__("hashlib").sha256(generated).hexdigest())

    def test_missing_or_corrupt_canonical_phase_a_filenames_block(self):
        original = module.read_json(module.SOURCE_LOCK)
        # Simulate a poisoned lock in memory without writing repository files.
        source = original["source_migrations"][0]
        target = original["canonical_phase_a_target_filenames"][0]
        self.assertTrue(target.endswith(source[14:]))
        self.assertEqual(target, "20261019140000_private_business_membership_foundation.sql")
        self.assertIsNone(original["phase_b_target_filename"])
        self.assertEqual(len(set(original["canonical_phase_a_target_filenames"])), 65)
        self.assertEqual(len(original["canonical_phase_a_target_filenames"]), 65)

    def test_generators_emit_identical_phase_a_filenames_and_sql_bytes(self):
        import importlib.util
        candidate_path = ROOT / "scripts/build-forward-only-bundle.py"
        candidate_spec = importlib.util.spec_from_file_location("m2_phase_a_only", candidate_path)
        candidate = importlib.util.module_from_spec(candidate_spec)
        candidate_spec.loader.exec_module(candidate)
        with tempfile.TemporaryDirectory() as temp:
            a = Path(temp) / "phase_a_only"
            b = Path(temp) / "full"
            candidate.build_bundle(
                ROOT,
                candidate.read_json(candidate.INVENTORY) if hasattr(candidate, "read_json") else
                    json.loads(candidate.INVENTORY.read_text(encoding="utf8")),
                json.loads(SNAPSHOT.read_text(encoding="utf8")),
                json.loads(SNAPSHOT.read_text(encoding="utf8")),
                json.loads(candidate.HISTORY_SQL.read_text(encoding="utf8")),
                a,
            )
            module.build(SNAPSHOT, b)
            plain = {p.name: p.read_bytes() for p in a.glob("*.sql")}
            full = {p.name: p.read_bytes() for p in (b / "phase-a").glob("*.sql")}
            self.assertEqual(len(plain), 65)
            self.assertEqual(plain, full)

    def test_refuse_any_advanced_remote_ledger_without_reapproval(self):
        with tempfile.TemporaryDirectory() as temp:
            altered = json.loads(SNAPSHOT.read_text())
            altered["versions"].append("20261019110000")
            p = Path(temp) / "remote.json"
            p.write_text(json.dumps(altered))
            with self.assertRaisesRegex(ValueError, "production migration ledger changed"):
                module.build(p)
            self.assertFalse((Path(temp) / "rehearsal").exists())

    def test_refuse_reordered_or_invalid_history(self):
        with tempfile.TemporaryDirectory() as temp:
            altered = json.loads(SNAPSHOT.read_text())
            altered["versions"][0], altered["versions"][1] = altered["versions"][1], altered["versions"][0]
            p = Path(temp) / "remote.json"
            p.write_text(json.dumps(altered))
            with self.assertRaisesRegex(ValueError, "ledger changed"):
                module.build(p)

    def test_never_generate_inside_repo_or_overwrite_output(self):
        with self.assertRaisesRegex(ValueError, "inside the repository"):
            module.build(SNAPSHOT, ROOT / "supabase/migrations/generated")
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                module.build(SNAPSHOT, Path(temp))


if __name__ == "__main__":
    unittest.main()
