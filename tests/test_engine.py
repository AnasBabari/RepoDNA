from __future__ import annotations

import io
import json
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from repodna.cli import build_parser
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
            self.assertEqual(payload["schemaVersion"], "1.1.0")

    def test_reuses_unchanged_files_from_incremental_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            repository = temporary / "repository"
            shutil.copytree(FIXTURE, repository)
            cache = temporary / "cache.json"
            first = analyze_repository(str(repository), cache_path=cache)
            second = analyze_repository(str(repository), cache_path=cache)
            self.assertEqual(first.metadata["cache"]["hits"], 0)
            self.assertEqual(second.metadata["cache"]["hits"], second.repository["fileCount"])
            changed_file = repository / "backend" / "main.py"
            changed_file.write_text(changed_file.read_text(encoding="utf-8") + "\n# changed\n", encoding="utf-8")
            third = analyze_repository(str(repository), cache_path=cache)
            self.assertEqual(third.metadata["cache"]["misses"], 1)

    def test_resolves_tsconfig_path_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tsconfig.json").write_text(json.dumps({
                "compilerOptions": {
                    "baseUrl": ".",
                    "paths": {
                        "@/*": ["src/*"],
                        "~/components/*": ["src/components/*"]
                    }
                }
            }), encoding="utf-8")
            (root / "src" / "components").mkdir(parents=True)
            (root / "src" / "components" / "Button.tsx").write_text("export function Button() {}", encoding="utf-8")
            (root / "src" / "App.tsx").write_text('import { Button } from "@/components/Button";', encoding="utf-8")
            res = analyze_repository(str(root))
            import_edge = next((edge for edge in res.imports if edge.source == "src/App.tsx"), None)
            self.assertIsNotNone(import_edge)
            self.assertEqual(import_edge.target, "src/components/Button.tsx")
            self.assertFalse(import_edge.external)

    def test_resolves_python_src_layout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pkg_dir = root / "src" / "mypackage"
            pkg_dir.mkdir(parents=True)
            (pkg_dir / "__init__.py").write_text("", encoding="utf-8")
            (pkg_dir / "service.py").write_text("def compute(): pass", encoding="utf-8")
            (pkg_dir / "api.py").write_text("from mypackage.service import compute\ncompute()", encoding="utf-8")
            res = analyze_repository(str(root))
            import_edge = next((edge for edge in res.imports if edge.source == "src/mypackage/api.py"), None)
            self.assertIsNotNone(import_edge)
            self.assertEqual(import_edge.target, "src/mypackage/service.py")
            self.assertFalse(import_edge.external)

    def test_cli_export_formats(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_path = Path(directory) / "project.json"
            self.result.write_json(project_path)

            parser = build_parser()
            # Mermaid format
            args_mermaid = parser.parse_args(["export", "--project", str(project_path), "--format", "mermaid"])
            buf = io.StringIO()
            with redirect_stdout(buf):
                args_mermaid.handler(args_mermaid)
            output = buf.getvalue()
            self.assertIn("flowchart TD", output)
            self.assertIn("frontend", output)

            # DOT format
            args_dot = parser.parse_args(["export", "--project", str(project_path), "--format", "dot"])
            buf = io.StringIO()
            with redirect_stdout(buf):
                args_dot.handler(args_dot)
            output_dot = buf.getvalue()
            self.assertIn("digraph Architecture", output_dot)


if __name__ == "__main__":
    unittest.main()
