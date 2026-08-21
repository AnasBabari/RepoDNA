from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from repodna.ingestion import IngestionError, IngestionLimits, discover_local, parse_github_url


class IngestionTests(unittest.TestCase):
    def test_honours_ignore_rules_and_limits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".gitignore").write_text("private.py\n", encoding="utf-8")
            (root / "visible.py").write_text("print('visible')", encoding="utf-8")
            (root / "private.py").write_text("SECRET = 'hidden'", encoding="utf-8")
            (root / "large.py").write_text("x" * 50, encoding="utf-8")
            result = discover_local(root, IngestionLimits(max_files=10, max_file_bytes=20))
            self.assertEqual([file.relative_path for file in result.files], ["visible.py"])
            self.assertIn("file_size_limit", {item["reason"] for item in result.skipped})

    def test_validates_public_github_urls(self) -> None:
        self.assertEqual(parse_github_url("https://github.com/openai/openai-python"), ("openai", "openai-python"))
        with self.assertRaises(IngestionError):
            parse_github_url("https://example.com/owner/repo")


if __name__ == "__main__":
    unittest.main()
