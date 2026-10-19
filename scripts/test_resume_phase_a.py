"""Offline tests for the pinned, manual-only DepotFlow Phase A runner.

No network access, database credentials or production writes.
"""
from datetime import datetime, timedelta
from pathlib import Path
import sys
from unittest.mock import patch
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resume_phase_a as phase_a


class PhaseAOfflineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.history, cls.stages = phase_a.inventory(Path("candidate"))

    def test_pooler_uri_is_expanded_into_libpq_environment(self):
        """Password must be environment-only; never a process argument."""
        template = (
            "postgresql://postgres.coyivbklakhilpcqqrzg:"
            "p%40ss%3Aword%21@aws-1-eu-west-1.pooler.supabase.com:"
            "5432/postgres?sslmode=require"
        )
        with patch.dict(phase_a.os.environ, {"PGDATABASE": template, "PGHOST": "bad-host"}):
            with patch.object(phase_a.subprocess, "run") as run:
                run.return_value.returncode = 0
                run.return_value.stdout = "1\n"
                result = phase_a.psql("SELECT 1;")
                self.assertEqual(result, "1")
                args, kwargs = run.call_args
                self.assertEqual(args[0][0], "psql")
                self.assertFalse(any("p%40ss" in v or "password" in v.lower() for v in args[0]))
                env = kwargs["env"]
                self.assertEqual(env["PGHOST"], "aws-1-eu-west-1.pooler.supabase.com")
                self.assertEqual(env["PGPORT"], "5432")
                self.assertEqual(env["PGDATABASE"], "postgres")
                self.assertEqual(env["PGUSER"], "postgres.coyivbklakhilpcqqrzg")
                self.assertEqual(env["PGPASSWORD"], "p@ss:word!")
                self.assertEqual(env["PGSSLMODE"], "require")
                self.assertEqual(env["PGCONNECT_TIMEOUT"], "20")
                self.assertEqual(kwargs["input"], "SELECT 1;")

    def test_pooler_uri_validation_rejects_wrong_target_and_option(self):
        base = (
            "postgresql://postgres.coyivbklakhilpcqqrzg:good-password"
            "@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
        )
        invalid = [
            base.replace("postgres.coyivbklakhilpcqqrzg", "postgres.another-project"),
            base.replace(".pooler.supabase.com", ".wrong.example"),
            base.replace(":5432/postgres", ":6543/postgres"),
            base.replace("sslmode=require", "sslmode=disable"),
            base.replace(":good-password@", ":@"),
            base.replace("/postgres?", "/wrong?"),
            base + "#fragment",
        ]
        for url in invalid:
            with self.subTest(url_type="invalid pooler connection"):
                with patch.dict(phase_a.os.environ, {"PGDATABASE": url}):
                    with self.assertRaises(RuntimeError):
                        phase_a.database_environment()

    def test_safe_classification_never_exposes_credentials_or_sql(self):
        """No raw stderr content, hostname, user or query may reach CI logs."""
        cases = [
            ("psql: FATAL: password authentication failed for user postgres.coyivbklakhilpcqqrzg",
             2, "authentication rejected"),
            ("psql: FATAL: Tenant or user not found", 2, "pooler rejected"),
            ("psql: could not translate host name \"private.example\" to address", 2, "DNS lookup"),
            ("psql: connection to server failed: connection timed out", 2, "timed out"),
            ("psql: connection to server failed: Connection refused", 2, "refused"),
            ("psql: SSL error: wrong version number", 2, "TLS"),
            ("psql: invalid URI query parameter: bogus", 2, "URI is malformed"),
            ("psql: ERROR: permission denied for schema private", 3, "lacks required SQL permissions"),
            ("psql: ERROR: relation \"secret_table\" does not exist", 3, "schema differs"),
            ("psql: ERROR: secret-query in literal: password=hunter2", 3, "SQL command failed"),
            ("psql: unknown network condition host-abc", 2, "connection failed"),
        ]
        for stderr, code, expected in cases:
            with self.subTest(expected=expected):
                message = phase_a.sanitized_psql_failure(stderr, code)
                self.assertIn(expected.lower(), message.lower())
                self.assertNotIn("hunter2", message)
                self.assertNotIn("postgres.coyivbklakhilpcqqrzg", message)
                self.assertNotIn("private.example", message)
                self.assertNotIn("secret_table", message)
                self.assertNotIn("secret-query", message)

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
        self.assertIn("begin;", sql.lower())
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
