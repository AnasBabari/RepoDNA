from __future__ import annotations

import fnmatch
import io
import re
import shutil
import tempfile
import urllib.error
import urllib.request
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Iterator


DEFAULT_IGNORES = {
    ".git", ".hg", ".svn", "node_modules", "venv", ".venv", "env",
    "dist", "build", "coverage", ".next", ".vinext", "__pycache__",
    "vendor", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    ".idea", ".vscode", ".repodna",
}
SOURCE_EXTENSIONS = {
    ".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
    ".json", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".sql",
    ".prisma", ".md", ".html", ".css", ".scss", ".dockerfile",
}
SPECIAL_FILES = {
    "Dockerfile", "Procfile", "Makefile", "Pipfile", "package.json",
    "requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile.lock",
    "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
    "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "tsconfig.json",
}
GITHUB_RE = re.compile(
    r"^https?://github\.com/(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)


class IngestionError(RuntimeError):
    pass


@dataclass(slots=True)
class IngestionLimits:
    max_files: int = 10_000
    max_file_bytes: int = 1_000_000
    max_archive_bytes: int = 100_000_000


@dataclass(slots=True)
class DiscoveredFile:
    absolute_path: Path
    relative_path: str
    size: int


@dataclass(slots=True)
class DiscoveryResult:
    root: Path
    name: str
    files: list[DiscoveredFile]
    skipped: list[dict[str, str]] = field(default_factory=list)
    source: str = "local"


class IgnoreMatcher:
    def __init__(self, root: Path) -> None:
        self.patterns: list[tuple[str, bool]] = []
        ignore_file = root / ".gitignore"
        if ignore_file.is_file():
            try:
                for raw in ignore_file.read_text(encoding="utf-8", errors="replace").splitlines():
                    line = raw.strip()
                    if not line or line.startswith("#"):
                        continue
                    negated = line.startswith("!")
                    if negated:
                        line = line[1:]
                    self.patterns.append((line.replace("\\", "/"), negated))
            except OSError:
                pass

    def ignored(self, relative: str, is_dir: bool = False) -> bool:
        relative = relative.replace("\\", "/").strip("/")
        parts = PurePosixPath(relative).parts
        if any(part in DEFAULT_IGNORES for part in parts):
            return True
        result = False
        for pattern, negated in self.patterns:
            normalized = pattern.strip("/")
            directory_pattern = pattern.endswith("/")
            matches = (
                fnmatch.fnmatch(relative, normalized)
                or fnmatch.fnmatch(PurePosixPath(relative).name, normalized)
                or (directory_pattern and any(part == normalized for part in parts))
                or ("/" not in normalized and any(fnmatch.fnmatch(part, normalized) for part in parts))
            )
            if matches and (not directory_pattern or is_dir or normalized in parts):
                result = not negated
        return result


def _is_candidate(path: Path) -> bool:
    return path.name in SPECIAL_FILES or path.suffix.lower() in SOURCE_EXTENSIONS


def _is_binary(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            sample = handle.read(8192)
    except OSError:
        return True
    return b"\0" in sample


def discover_local(root: Path, limits: IngestionLimits | None = None) -> DiscoveryResult:
    limits = limits or IngestionLimits()
    root = root.resolve()
    if not root.is_dir():
        raise IngestionError(f"Repository path does not exist or is not a directory: {root}")

    matcher = IgnoreMatcher(root)
    result = DiscoveryResult(root=root, name=root.name, files=[])
    for path in root.rglob("*"):
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            continue
        if path.is_symlink():
            result.skipped.append({"path": relative, "reason": "symlink"})
            continue
        if path.is_dir() or matcher.ignored(relative, is_dir=False):
            continue
        if not _is_candidate(path):
            continue
        try:
            size = path.stat().st_size
        except OSError:
            result.skipped.append({"path": relative, "reason": "unreadable"})
            continue
        if size > limits.max_file_bytes:
            result.skipped.append({"path": relative, "reason": "file_size_limit"})
            continue
        if _is_binary(path):
            result.skipped.append({"path": relative, "reason": "binary"})
            continue
        result.files.append(DiscoveredFile(path, relative, size))
        if len(result.files) >= limits.max_files:
            result.skipped.append({"path": "*", "reason": "file_count_limit"})
            break
    result.files.sort(key=lambda item: item.relative_path)
    return result


def parse_github_url(url: str) -> tuple[str, str]:
    match = GITHUB_RE.fullmatch(url.strip())
    if not match:
        raise IngestionError("GitHub source must be a public repository URL such as https://github.com/owner/repo")
    return match.group("owner"), match.group("repo")


def _download_archive(owner: str, repo: str, limits: IngestionLimits) -> bytes:
    errors: list[str] = []
    for branch in ("main", "master"):
        url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip"
        request = urllib.request.Request(url, headers={"User-Agent": "RepoDNA/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content_length = int(response.headers.get("Content-Length", "0") or 0)
                if content_length > limits.max_archive_bytes:
                    raise IngestionError("GitHub archive exceeds the configured download limit")
                payload = response.read(limits.max_archive_bytes + 1)
                if len(payload) > limits.max_archive_bytes:
                    raise IngestionError("GitHub archive exceeds the configured download limit")
                return payload
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            errors.append(f"{branch}: {exc}")
    raise IngestionError(f"Could not download public GitHub repository {owner}/{repo}: {'; '.join(errors)}")


def _safe_extract_zip(payload: bytes, destination: Path) -> Path:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = archive.infolist()
        roots = {PurePosixPath(member.filename).parts[0] for member in members if member.filename}
        if len(roots) != 1:
            raise IngestionError("GitHub archive has an unexpected directory structure")
        root_name = next(iter(roots))
        destination_resolved = destination.resolve()
        for member in members:
            member_path = destination / member.filename
            resolved = member_path.resolve()
            if destination_resolved not in resolved.parents and resolved != destination_resolved:
                raise IngestionError("GitHub archive contains an unsafe path")
            if member.is_dir():
                resolved.mkdir(parents=True, exist_ok=True)
                continue
            resolved.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, resolved.open("wb") as target:
                shutil.copyfileobj(source, target)
    return destination / root_name


@contextmanager
def repository_source(source: str, limits: IngestionLimits | None = None) -> Iterator[DiscoveryResult]:
    limits = limits or IngestionLimits()
    if source.startswith(("https://github.com/", "http://github.com/")):
        owner, repo = parse_github_url(source)
        with tempfile.TemporaryDirectory(prefix="repodna-") as temp:
            root = _safe_extract_zip(_download_archive(owner, repo, limits), Path(temp))
            result = discover_local(root, limits)
            result.name = repo
            result.source = f"github:{owner}/{repo}"
            yield result
        return
    yield discover_local(Path(source), limits)

