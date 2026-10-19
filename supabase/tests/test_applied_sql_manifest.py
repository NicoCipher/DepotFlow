"""Read-only PR release-evidence checks. Does not open a production connection."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/m2-applied-sql-reconciliation-manifest-20261019.json"
LIVE_HISTORY = ROOT / "supabase/tests/fixtures/production_migration_history_20261018.json"
START = "---------------- ORIGINAL APPLIED SQL (BEGIN) ----------------\n"
END = "\n---------------- ORIGINAL APPLIED SQL (END) ----------------"


class AppliedSqlEvidenceContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence = json.loads(MANIFEST.read_text(encoding="utf8"))
        cls.remote = json.loads(LIVE_HISTORY.read_text(encoding="utf8"))

    def test_all_live_versions_accounted_once(self):
        versions = [x["version"] for x in self.evidence["entries"]]
        self.assertEqual(len(versions), 55)
        self.assertEqual(len(set(versions)), len(versions))
        self.assertEqual(set(versions), set(self.remote["versions"]))
        self.assertEqual(self.evidence["captured_on"], "2026-10-19")
        self.assertFalse(self.evidence["release_authorized"])

    def test_classifications_are_explicit_and_sum_to_55(self):
        counts = {}
        for x in self.evidence["entries"]:
            counts[x["status"]] = counts.get(x["status"], 0) + 1
        self.assertEqual(counts, {
            "byte_exact": 29,
            "lexical_only": 22,
            "original_applied_sql_archived": 4,
        })
        self.assertEqual(counts, self.evidence["provenance_counts"])

    def test_all_source_candidates_exist_without_repairing_versions(self):
        for row in self.evidence["entries"]:
            candidate = row.get("localCandidate")
            if candidate:
                self.assertTrue((ROOT / "supabase/migrations" / candidate).is_file(),
                                (row["version"], candidate))
            else:
                self.assertEqual(row["status"], "original_applied_sql_archived")

    def test_archived_sql_text_md5_is_preserved(self):
        for row in self.evidence["entries"]:
            if row["status"] != "original_applied_sql_archived":
                continue
            file = ROOT / row["archive"]
            self.assertTrue(file.is_file(), row["archive"])
            self.assertTrue(file.name.endswith(".sql.txt"))
            body = file.read_text(encoding="utf8")
            self.assertIn("DO NOT EXECUTE", body)
            self.assertIn(START, body)
            self.assertIn(END, body)
            sql = body.split(START, 1)[1].rsplit(END, 1)[0]
            digest = hashlib.md5(sql.encode("utf8")).hexdigest()
            self.assertEqual(digest, row["md5"], row["version"])


if __name__ == "__main__":
    unittest.main()
