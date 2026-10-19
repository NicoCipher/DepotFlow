"""Fail-closed regression checks for the hosted-vs-historical M2 schema audit."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts/classify-m2-schema-drift.py"
spec = importlib.util.spec_from_file_location("schema_drift", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ShapeClassificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = json.loads(module.HOSTED.read_text())

    def make_known_historical(self):
        old = copy.deepcopy(self.live)
        old.pop("project", None)
        for kind, objects in module.EXPECTED_NEW.items():
            for obj in objects:
                old["shape_by_kind"][kind].pop(obj)
        for func in module.EXPECTED_AUTH_FUNCTIONS:
            old["functions"].pop(func)
        for func in module.EXPECTED_EXISTING_FUNCTION_DRIFT:
            old["functions"][func] = "f" * 32

        # 235 managed REFERENCES grants account for the difference 473-238.
        # Synthesize distinct per-table candidate counts only for the test.
        grants = old["column_grants"]
        keys = sorted(grants)
        self.assertEqual(len(keys), 29)
        to_reduce = 235
        for name in keys[:28]:
            self.assertGreater(grants[name]["count"], 1)
            grants[name]["count"] -= 1
            grants[name]["hash"] = "e" * 32
            to_reduce -= 1
        for name in keys[:28]:
            capacity = grants[name]["count"] - 1
            adjust = min(to_reduce, capacity)
            grants[name]["count"] -= adjust
            to_reduce -= adjust
            if to_reduce == 0:
                break
        self.assertEqual(to_reduce, 0)
        self.assertEqual(sum(x["count"] for x in grants.values()), 238)
        return old

    def test_only_known_expected_differences_accepted(self):
        old = self.make_known_historical()
        report, errors = module.differences(self.live, old)
        self.assertEqual(errors, [])
        self.assertEqual(len(report), 6)
        self.assertTrue(all(v["classification"] != "UNCLASSIFIED" for v in report.values()))

    def test_unknown_added_column_and_changed_original_index_fail(self):
        old = self.make_known_historical()
        old["shape_by_kind"]["columns"].pop("public.customers.id")
        old["shape_by_kind"]["indexes"]["public.customers_pkey"] = "0" * 32
        _, errors = module.differences(self.live, old)
        self.assertTrue(any("columns" in e for e in errors))
        self.assertTrue(any("indexes" in e for e in errors))

    def test_unrecognized_historical_function_drift_fails(self):
        old = self.make_known_historical()
        old["functions"]["private.unknown_extra_function()"] = "1" * 32
        _, errors = module.differences(self.live, old)
        self.assertTrue(any("functions" in e for e in errors))

    def test_unknown_privilege_inventory_delta_fails(self):
        old = self.make_known_historical()
        old["column_grants"]["public.customers"]["count"] += 1
        _, errors = module.differences(self.live, old)
        self.assertTrue(any("column_grants" in e for e in errors))

    def test_wrong_production_provenance_fails(self):
        old = self.make_known_historical()
        live = copy.deepcopy(self.live)
        live["migration_tip"] = "20261019140104"
        with self.assertRaisesRegex(ValueError, "provenance"):
            module.differences(live, old)


if __name__ == "__main__":
    unittest.main()
