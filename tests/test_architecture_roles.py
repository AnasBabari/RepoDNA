import unittest

from repodna.graph import build_architecture, classify_file, classification_confidence
from repodna.model import FileRecord


class ArchitectureRoleTests(unittest.TestCase):
    def test_generic_python_and_backend_containers_remain_neutral(self):
        for path in ["src/requests/session.py", "app/main.py", "src/backend.ts", "src/client/http.py", "app/views/users.py"]:
            with self.subTest(path=path):
                category, evidence = classify_file(path, set(), set())
                self.assertEqual(category, "other")
                self.assertEqual(classification_confidence(category, evidence), 0.35)

    def test_presentation_and_component_evidence_are_distinct(self):
        for path in ["src/App.tsx", "app/page.tsx", "frontend/styles.css"]:
            self.assertEqual(classify_file(path, set(), set()), ("frontend", ["presentation-capable file extension"]))
        self.assertEqual(classify_file("src/App.js", set(), {"component"}), ("frontend", ["UI component symbol"]))
        self.assertEqual(classify_file("app/api/route.ts", {"app/api/route.ts"}, {"component"})[0], "api")

    def test_group_confidence_keeps_weaker_directory_heuristics_explicit(self):
        files = [FileRecord(path, path, "TypeScript", 10, 10, path) for path in ["src/App.tsx", "frontend/helpers.ts", "app/main.py"]]
        architecture, _ = build_architecture(files, [], [], [])
        groups = {item["type"]: item for item in architecture["components"]}
        self.assertEqual(groups["frontend"]["confidence"], 0.65)
        self.assertEqual(groups["other"]["confidence"], 0.35)
