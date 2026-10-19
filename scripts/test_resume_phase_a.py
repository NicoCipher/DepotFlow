"""Offline tests for the pinned, manual-only DepotFlow Phase A runner.

No network access, database credentials or production writes.
"""
from datetime import datetime, timedelta
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resume_phase_a as phase_a


class PhaseAOfflineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.history, cls.stages = phase_a.inventory(Path("candidate"))

    def test_all_65_canonical_versions_cross_minute_boundary(self):
        self.assertEqual(len(self.stages), 65)
        self.assertEqual(len(self.history), 121)
        start = datetime.strptime("20261019140000", "%Y%m%d%H%M%S")
        versions = [
            (start + timedelta(seconds=i)).strftime("%Y%m%d%H%M%S")
            for i in range(65)
        ]
        self.assertEqual(
            [stage["version"] for stage in self.stages], versions
        )
        self.assertEqual(versions[59], "20261019140059")
        self.assertEqual(versions[60], "20261019140100")
        self.assertEqual(versions[-1], "20261019140104")

    def test_first_unapplied_stage_is_13(self):
        self.assertEqual(
            phase_a.progress(self.history, self.history[:68]), 12
        )
        self.assertEqual(self.stages[12]["version"], "20261019140012")
        self.assertEqual(
            self.stages[12]["name"], "legacy_customer_reader_scope"
        )

    def test_transaction_keeps_sql_and_ledger_atomic(self):
        stage = self.stages[12]
        sql = phase_a.make_transaction(
            stage, self.history[67]["version"], 68
        )
        self.assertEqual(sql.lstrip().lower().find("begin;"), 0)
        self.assertTrue(sql.rstrip().lower().endswith("commit;"))
        self.assertIn(
            "INSERT INTO supabase_migrations.schema_migrations(version,name,statements)",
            sql,
        )
        self.assertNotIn(
            "INSERT INTO supabase_migrations.schema_migrations(version,name,statements,created_by)",
            sql,
        )
        self.assertIn(
            "LOCK TABLE supabase_migrations.schema_migrations", sql
        )
        self.assertIn(
            "Phase A postcheck failed at 20261019140012", sql
        )
        self.assertIn("Exactly four reporting RPCs must be patched", sql)

    def test_ledger_divergence_fails_closed(self):
        corrupted = [dict(item) for item in self.history[:68]]
        corrupted[-1]["name"] = "wrong_migration"
        with self.assertRaisesRegex(RuntimeError, "migration versions/names"):
            phase_a.progress(self.history, corrupted)
        with self.assertRaisesRegex(RuntimeError, "migration versions/names"):
            phase_a.progress(self.history, self.history[:67])

    def test_all_65_sql_transactions_can_be_wrapped(self):
        for i, stage in enumerate(self.stages):
            with self.subTest(stage=i+1):
                prev = self.history[55+i]["version"]
                statement = phase_a.make_transaction(stage, prev, 56+i)
                self.assertTrue(statement.rstrip().lower().endswith("commit;"))
                self.assertIn(
                    "VALUES ('"+stage["version"]+"','"+stage["name"]+"'", statement
                )
        self.assertNotEqual(
            self.stages[-1]["name"], "finalize_legacy_creation_api_cutover"
        )


if __name__ == "__main__":
    unittest.main()
