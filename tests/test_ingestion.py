from __future__ import annotations

import io
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest.mock import patch

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

    def test_honours_total_local_source_size_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "a.py").write_text("a" * 12, encoding="utf-8")
            (root / "b.py").write_text("b" * 12, encoding="utf-8")

            result = discover_local(root, IngestionLimits(max_total_source_bytes=20))

            self.assertEqual([file.relative_path for file in result.files], ["a.py"])
            self.assertIn("total_size_limit", {item["reason"] for item in result.skipped})

    def test_local_caps_do_not_depend_on_filesystem_entry_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name in ("b.py", "a.py"):
                (root / name).write_text("x" * 12, encoding="utf-8")
            for order in (("a.py", "b.py"), ("b.py", "a.py")):
                entries = [root / name for name in order]
                # Emulate arbitrary native enumeration at both traversal seams.
                with patch.object(Path, "iterdir", lambda _: iter(entries)), patch.object(
                    Path, "rglob", lambda _, pattern: iter([] if pattern == ".gitignore" else entries)
                ):
                    for limits, reason in (
                        (IngestionLimits(max_total_source_bytes=20), "total_size_limit"),
                        (IngestionLimits(max_files=1), "file_count_limit"),
                    ):
                        with self.subTest(order=order, reason=reason):
                            result = discover_local(root, limits)
                            self.assertEqual([item.relative_path for item in result.files], ["a.py"])
                            self.assertEqual(result.skipped, [{"path": "b.py" if reason == "total_size_limit" else "*", "reason": reason}])

    def test_sorted_walk_preserves_symlink_and_unreadable_directory_boundaries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "a.py").write_text("pass", encoding="utf-8")
            blocked = root / "z"
            blocked.mkdir()
            (blocked / "hidden.py").write_text("pass", encoding="utf-8")
            original_iterdir, original_is_symlink = Path.iterdir, Path.is_symlink
            for boundary in ("symlink", "unreadable"):
                def entries(path: Path):
                    if path == blocked:
                        if boundary == "symlink":
                            raise AssertionError("followed a directory symlink")
                        raise PermissionError("unreadable directory")
                    return iter(reversed(list(original_iterdir(path))))
                def is_symlink(path: Path):
                    return (boundary == "symlink" and path == blocked) or original_is_symlink(path)
                with self.subTest(boundary=boundary), patch.object(Path, "iterdir", entries), patch.object(Path, "is_symlink", is_symlink):
                    result = discover_local(root)
                    self.assertEqual([item.relative_path for item in result.files], ["a.py"])
                    if boundary == "symlink":
                        self.assertIn({"path": "z", "reason": "symlink"}, result.skipped)

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
                _safe_extract_zip(
                    payload.getvalue(),
                    Path(directory),
                    IngestionLimits(max_total_extracted_bytes=20),
                )

    def test_rejects_archive_entry_count_bombs(self) -> None:
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("repo/one.py", "print(1)")
            archive.writestr("repo/two.py", "print(2)")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(IngestionError, "entry-count"):
                _safe_extract_zip(
                    payload.getvalue(),
                    Path(directory),
                    IngestionLimits(max_archive_entries=1),
                )

    def test_rejects_duplicate_normalized_archive_paths(self) -> None:
        payload = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(payload, "w") as archive:
                archive.writestr("repo/index.py", "print(1)")
                archive.writestr("repo/index.py", "print(2)")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(IngestionError, "duplicate"):
                _safe_extract_zip(payload.getvalue(), Path(directory), IngestionLimits())


if __name__ == "__main__":
    unittest.main()
