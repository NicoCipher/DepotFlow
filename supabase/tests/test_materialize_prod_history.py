"""Zero-dollar schema reconstruction input integrity, never connects remotely."""
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))
from importlib.machinery import SourceFileLoader

module = SourceFileLoader("history_replay", str(SCRIPT_DIR / "materialize-prod-history.py")).load_module()


class HistoryReplayTests(unittest.TestCase):
    def test_reproduces_fifty_five_ordered_applied_versions_only_in_temp_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            files = module.materialize(Path(tmp) / "replay")
            self.assertEqual(len(files), 55)
            self.assertEqual(len(set(f.name for f in files)), 55)
            self.assertTrue(files[0].name.startswith("001_20260912230917"))
            self.assertTrue(files[-1].name.endswith("20261017132742.sql"))
            for file in files:
                self.assertTrue(file.read_text(encoding="utf8").strip())
                self.assertEqual(file.parent, Path(tmp) / "replay")

    def test_archived_sql_matches_checksum_without_executing(self):
        manifest = json.loads(module.MANIFEST.read_text(encoding="utf8"))
        archived = [x for x in manifest["entries"]
                    if x["status"] == "original_applied_sql_archived"]
        self.assertEqual(len(archived), 4)
        for record in archived:
            txt = module.verified_sql(record)
            self.assertEqual(hashlib.md5(txt.encode("utf8")).hexdigest(),
                             record["md5"])

    def test_refuses_untrusted_path_or_unverified_candidate(self):
        with self.assertRaisesRegex(ValueError, "Invalid repository candidate"):
            module.verified_sql({
                "status": "byte_exact",
                "version": "20261017132742",
                "localCandidate": "../../secret.sql",
            })
        with self.assertRaisesRegex(ValueError, "Archive missing"):
            module.verified_sql({
                "status": "original_applied_sql_archived",
                "version": "20261017132742",
                "archive": "../../secret.sql.txt",
            })


if __name__ == "__main__":
    unittest.main()
