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
    ".idea", ".vscode", ".repodna", ".turbo", ".cache",
}
SOURCE_EXTENSIONS = {
    ".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
    ".json", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".sql",
    ".prisma", ".md", ".mdx", ".html", ".css", ".scss", ".dockerfile",
    ".sh", ".bash", ".graphql", ".gql",
}
SPECIAL_FILES = {
    "Dockerfile", "Procfile", "Makefile", "Pipfile", "package.json",
    "requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile.lock",
    "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
    "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "tsconfig.json", "jsconfig.json",
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
        self.root = root.resolve()
        self.rules: list[tuple[str, str, bool, bool]] = []
        self._load_gitignore(self.root, "")

    def _load_gitignore(self, dir_path: Path, relative_dir: str) -> None:
        ignore_file = dir_path / ".gitignore"
        if ignore_file.is_file():
            try:
                for raw in ignore_file.read_text(encoding="utf-8", errors="replace").splitlines():
                    line = raw.strip()
                    if not line or line.startswith("#"):
                        continue
                    negated = line.startswith("!")
                    if negated:
                        line = line[1:].strip()
                    is_dir_only = line.endswith("/")
                    line = line.rstrip("/").replace("\\", "/")
                    if line.startswith("/"):
                        pattern = line.lstrip("/")
                    else:
                        pattern = line
                    self.rules.append((relative_dir, pattern, negated, is_dir_only))
            except OSError:
                pass

    def add_nested_gitignore(self, dir_path: Path, relative_dir: str) -> None:
        self._load_gitignore(dir_path, relative_dir)

    def ignored(self, relative: str, is_dir: bool = False) -> bool:
        relative = relative.replace("\\", "/").strip("/")
        parts = PurePosixPath(relative).parts
        if any(part in DEFAULT_IGNORES for part in parts):
            return True

        result = False
        for base_dir, pattern, negated, is_dir_only in self.rules:
            if is_dir_only and not is_dir:
                continue

            if base_dir:
                if relative == base_dir:
                    rel_to_base = ""
                elif relative.startswith(base_dir + "/"):
                    rel_to_base = relative[len(base_dir) + 1:]
                else:
                    continue
            else:
                rel_to_base = relative

            if not rel_to_base:
                continue

            if "/" in pattern:
                normalized_pattern = pattern.lstrip("/")
                if (
                    fnmatch.fnmatch(rel_to_base, normalized_pattern)
                    or fnmatch.fnmatch(rel_to_base, f"**/{normalized_pattern}")
                ):
                    result = not negated
            else:
                rel_parts = PurePosixPath(rel_to_base).parts
                if (
                    fnmatch.fnmatch(PurePosixPath(rel_to_base).name, pattern)
                    or any(fnmatch.fnmatch(p, pattern) for p in rel_parts)
                ):
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

    # First pass: load any nested .gitignores in subdirectories
    for gitignore_path in root.rglob(".gitignore"):
        if gitignore_path.is_file() and gitignore_path.parent != root:
            try:
                rel_dir = gitignore_path.parent.relative_to(root).as_posix()
                matcher.add_nested_gitignore(gitignore_path.parent, rel_dir)
            except ValueError:
                pass

    for path in root.rglob("*"):
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            continue
        if path.is_symlink():
            result.skipped.append({"path": relative, "reason": "symlink"})
            continue
        if path.is_dir():
            continue
        if matcher.ignored(relative, is_dir=False):
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


RESERVED_GITHUB_ROOT_SEGMENTS = {
    "settings", "explore", "pricing", "features", "pulls", "issues",
    "notifications", "marketplace", "trending", "collections", "events",
    "sponsors", "organizations", "account", "login", "signup", "logout",
    "about", "contact", "security", "site", "privacy", "terms",
}


def _is_valid_owner_repo(owner: str, repo: str) -> bool:
    if not owner or not repo:
        return False
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", owner) or not re.fullmatch(r"[A-Za-z0-9_.-]+", repo):
        return False
    if owner in {".", ".."} or repo in {".", ".."}:
        return False
    if owner.lower() in RESERVED_GITHUB_ROOT_SEGMENTS:
        return False
    return True


def parse_github_url(url: str) -> tuple[str, str]:
    if not url or not isinstance(url, str):
        raise IngestionError("GitHub source must be a valid repository URL or owner/repo format")

    cleaned = url.strip().strip('"\'').strip()
    if not cleaned:
        raise IngestionError("Empty repository URL")

    # Reject credential-bearing URLs (e.g. https://user:pass@github.com)
    if "@" in cleaned and re.match(r"^https?://", cleaned, re.IGNORECASE):
        raise IngestionError("Credential-bearing URLs are not permitted")

    # SSH format:
    # 1. git@github.com:owner/repo(.git)
    # 2. ssh://git@github.com/owner/repo.git or ssh://git@github.com:22/owner/repo.git
    # 3. git+ssh://git@github.com/owner/repo.git
    ssh_match = re.match(
        r"^(?:git\+ssh://|ssh://)?git@github\.com(?::(?:\d+/)?|:|/)(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$",
        cleaned,
        re.IGNORECASE,
    )
    if ssh_match:
        owner = ssh_match.group("owner")
        repo = re.sub(r"\.git$", "", ssh_match.group("repo"), flags=re.IGNORECASE)
        if _is_valid_owner_repo(owner, repo):
            return owner, repo

    # Strip prefixes
    cleaned = re.sub(r"^(?:git\+|git://|ssh://)", "", cleaned, flags=re.IGNORECASE)

    # Normalize github.com / www.github.com
    if re.match(r"^(?:www\.)?github\.com/", cleaned, re.IGNORECASE):
        cleaned = "https://" + cleaned

    # Full URL parsing
    if re.match(r"^https?://", cleaned, re.IGNORECASE):
        try:
            parsed = urllib.parse.urlparse(cleaned)
            hostname = (parsed.hostname or "").lower()
            if hostname not in {"github.com", "www.github.com"}:
                raise IngestionError(f"Host '{hostname}' is not supported. Only github.com is supported.")

            if parsed.username or parsed.password:
                raise IngestionError("Credential-bearing URLs are not permitted")

            segments = [s for s in parsed.path.split("/") if s]
            if len(segments) >= 2:
                owner = segments[0]
                repo = re.sub(r"\.git$", "", segments[1], flags=re.IGNORECASE)
                if _is_valid_owner_repo(owner, repo):
                    return owner, repo
        except Exception as exc:
            if isinstance(exc, IngestionError):
                raise
            raise IngestionError(f"Malformed repository URL: '{url}'") from exc

    # Short format: owner/repo
    short_clean = re.sub(r"^@", "", cleaned).split("?")[0].split("#")[0].rstrip("/")
    parts = short_clean.split("/")
    if len(parts) == 2:
        owner, repo = parts
        repo = re.sub(r"\.git$", "", repo, flags=re.IGNORECASE)
        if _is_valid_owner_repo(owner, repo) and ":" not in owner and "." not in owner:
            return owner, repo

    raise IngestionError(f"Invalid GitHub repository URL: '{url}'. Expected format: https://github.com/owner/repository")


def _download_archive(owner: str, repo: str, limits: IngestionLimits) -> bytes:
    url = f"https://codeload.github.com/{owner}/{repo}/zip/HEAD"
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
        raise IngestionError(f"Could not download public GitHub repository {owner}/{repo}: {exc}") from exc


def _safe_extract_zip(payload: bytes, destination: Path, limits: IngestionLimits) -> Path:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = archive.infolist()
        if sum(member.file_size for member in members) > limits.max_archive_bytes:
            raise IngestionError("GitHub archive exceeds the configured extracted-size limit")
        roots = {PurePosixPath(member.filename).parts[0] for member in members if member.filename}
        if len(roots) != 1:
            raise IngestionError("GitHub archive has an unexpected directory structure")
        root_name = next(iter(roots))
        destination_resolved = destination.resolve()
        for member in members:
            member_parts = PurePosixPath(member.filename).parts
            if ".." in member_parts or PurePosixPath(member.filename).is_absolute():
                raise IngestionError("GitHub archive contains an unsafe path")
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
def repository_source(source: str | Path, limits: IngestionLimits | None = None) -> Iterator[DiscoveryResult]:
    limits = limits or IngestionLimits()
    source_str = str(source)
    is_github = (
        source_str.startswith(("https://", "http://", "github.com", "www.github.com", "git@github.com", "git+"))
        or (not Path(source_str).exists() and "/" in source_str and len(source_str.split("/")) == 2)
    )
    if is_github:
        owner, repo = parse_github_url(source_str)
        with tempfile.TemporaryDirectory(prefix="repodna-") as temp:
            root = _safe_extract_zip(_download_archive(owner, repo, limits), Path(temp), limits)
            result = discover_local(root, limits)
            result.name = repo
            result.source = f"github:{owner}/{repo}"
            yield result
        return
    yield discover_local(Path(source), limits)
