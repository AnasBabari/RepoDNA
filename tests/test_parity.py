import json
import unittest
from pathlib import Path
from core.repodna.engine import analyze_repository
from core.repodna.schema_validator import validate_analysis_result


class ParitySchemaConformanceTests(unittest.TestCase):
    def test_fastapi_basic_schema_conformance(self):
        fixture_path = Path("tests/fixtures/fastapi-basic")
        if not fixture_path.exists():
            self.skipTest("Fixture not found")

        result = analyze_repository(fixture_path)
        payload = result.to_dict()

        valid, errors = validate_analysis_result(payload)
        self.assertTrue(valid, f"Schema validation errors: {errors}")
        self.assertEqual(payload["schemaVersion"], "1.1.0")
        self.assertIn("FastAPI", payload["repository"]["fingerprint"]["frameworks"])
        self.assertGreater(len(payload["routes"]), 0)
        self.assertGreater(len(payload["architecture"]["components"]), 0)

    def test_express_basic_schema_conformance(self):
        fixture_path = Path("tests/fixtures/express-basic")
        if not fixture_path.exists():
            self.skipTest("Fixture not found")

        result = analyze_repository(fixture_path)
        payload = result.to_dict()

        valid, errors = validate_analysis_result(payload)
        self.assertTrue(valid, f"Schema validation errors: {errors}")
        self.assertEqual(payload["schemaVersion"], "1.1.0")
        self.assertIn("Express", payload["repository"]["fingerprint"]["frameworks"])
        self.assertGreater(len(payload["routes"]), 0)

    def test_rejects_malformed_schema_payloads(self):
        fixture_path = Path("tests/fixtures/fastapi-basic")
        if not fixture_path.exists():
            self.skipTest("Fixture not found")

        result = analyze_repository(fixture_path)
        payload = result.to_dict()

        # 1. Invalid parseSuccessRate > 100
        invalid_rate = dict(payload)
        invalid_rate["metrics"] = dict(payload["metrics"])
        invalid_rate["metrics"]["parseSuccessRate"] = 105.0
        valid, errors = validate_analysis_result(invalid_rate)
        self.assertFalse(valid)
        self.assertTrue(any("100" in e for e in errors))

        # 2. Missing required top-level field
        missing_routes = dict(payload)
        del missing_routes["routes"]
        valid, errors = validate_analysis_result(missing_routes)
        self.assertFalse(valid)
        self.assertTrue(any("routes" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
