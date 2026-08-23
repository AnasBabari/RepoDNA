from __future__ import annotations

import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from repodna.ingestion import IngestionError, IngestionLimits, _safe_extract_zip, discover_local, parse_github_url


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

    def test_honours_nested_gitignore(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "packages" / "ui").mkdir(parents=True)
            (root / "packages" / "ui" / ".gitignore").write_text("dist/\n*.cache\n", encoding="utf-8")
            (root / "packages" / "ui" / "dist").mkdir(parents=True)
            (root / "packages" / "ui" / "dist" / "index.js").write_text("built", encoding="utf-8")
            (root / "packages" / "ui" / "temp.cache").write_text("cache", encoding="utf-8")
            (root / "packages" / "ui" / "src").mkdir(parents=True)
            (root / "packages" / "ui" / "src" / "index.ts").write_text("export const UI = true;", encoding="utf-8")

            result = discover_local(root)
            paths = [file.relative_path for file in result.files]
            self.assertIn("packages/ui/src/index.ts", paths)
            self.assertNotIn("packages/ui/dist/index.js", paths)
            self.assertNotIn("packages/ui/temp.cache", paths)

    def test_validates_public_github_urls(self) -> None:
        self.assertEqual(parse_github_url("https://github.com/openai/openai-python"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("github.com/openai/openai-python"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("www.github.com/openai/openai-python"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("git@github.com:openai/openai-python.git"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("ssh://git@github.com/openai/openai-python.git"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("ssh://git@github.com:22/openai/openai-python.git"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("git+ssh://git@github.com/openai/openai-python.git"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("https://github.com/openai/openai-python/tree/main"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("https://github.com/openai/openai-python/tree/feature/sub-branch"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("https://github.com/openai/openai-python/blob/main/src/index.py"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("https://github.com/openai/openai-python?tab=readme-ov-file"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("openai/openai-python"), ("openai", "openai-python"))
        self.assertEqual(parse_github_url("@openai/openai-python"), ("openai", "openai-python"))

        # Strict security rejections
        with self.assertRaises(IngestionError):
            parse_github_url("https://gitlab.com/owner/repo")
        with self.assertRaises(IngestionError):
            parse_github_url("https://attacker.github.com.evil.com/owner/repo")
        with self.assertRaises(IngestionError):
            parse_github_url("https://github.com.evil.com/owner/repo")
        with self.assertRaises(IngestionError):
            parse_github_url("http://169.254.169.254/owner/repo")
        with self.assertRaises(IngestionError):
            parse_github_url("https://user:pass@github.com/owner/repo")
        with self.assertRaises(IngestionError):
            parse_github_url("https://github.com/settings")

    def test_rejects_archive_path_traversal(self) -> None:
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("repo/../escape.py", "print('unsafe')")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(IngestionError):
                _safe_extract_zip(payload.getvalue(), Path(directory), IngestionLimits())

    def test_rejects_oversized_extracted_archive(self) -> None:
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("repo/large.py", "x" * 50)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(IngestionError):
                _safe_extract_zip(payload.getvalue(), Path(directory), IngestionLimits(max_archive_bytes=20))


if __name__ == "__main__":
    unittest.main()
