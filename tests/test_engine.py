from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from repodna.engine import analyze_repository
from repodna.graph import impact_slice


ROOT = Path(__file__).parent
FIXTURE = ROOT / "fixtures" / "mixed-basic"


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.result = analyze_repository(str(FIXTURE))

    def test_matches_golden_architecture_summary(self) -> None:
        expected = json.loads((ROOT / "golden" / "mixed-basic.json").read_text(encoding="utf-8"))
        actual = {
            "repository": {
                "name": self.result.repository["name"],
                "languages": sorted(self.result.repository["languages"]),
            },
            "technologies": sorted(self.result.technologies),
            "routes": sorted(f"{route.method} {route.path}" for route in self.result.routes),
            "components": sorted(component["type"] for component in self.result.architecture["components"] if component["type"] not in {"configuration", "other"}),
            "entrypoints": sorted(entry.file for entry in self.result.entrypoints),
        }
        self.assertEqual(actual, expected)

    def test_resolves_layer_dependencies(self) -> None:
        edges = {(edge.source, edge.target) for edge in self.result.imports if edge.target}
        self.assertIn(("backend/routes/users.py", "backend/services/users.py"), edges)
        self.assertIn(("backend/services/users.py", "backend/repositories/users.py"), edges)
        self.assertIn(("frontend/App.tsx", "frontend/components/UserCard.tsx"), edges)

    def test_builds_route_flow_and_impact(self) -> None:
        flow = next(flow for flow in self.result.flows if flow["name"] == "POST /users")
        labels = [node["label"] for node in flow["nodes"]]
        self.assertIn("create_user", labels)
        impact = impact_slice("UserService", self.result.symbols, self.result.imports, self.result.calls)
        self.assertTrue(impact["matches"])
        self.assertIn("backend/routes/users.py", impact["dependents"])

    def test_never_includes_ignored_file_and_exports_json(self) -> None:
        self.assertNotIn("ignored.py", {file.path for file in self.result.files})
        self.assertFalse(self.result.metadata["executedRepositoryCode"])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "project.json"
            self.result.write_json(target)
            payload = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(payload["schemaVersion"], "1.0.0")


if __name__ == "__main__":
    unittest.main()
