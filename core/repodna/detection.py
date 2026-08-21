from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import PurePosixPath
from typing import Iterable

from repodna.ingestion import DiscoveryResult


LANGUAGES = {
    ".py": "Python", ".pyi": "Python", ".js": "JavaScript", ".jsx": "JavaScript",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
    ".sql": "SQL", ".prisma": "Prisma", ".html": "HTML", ".css": "CSS", ".scss": "SCSS",
}

PACKAGE_TECH = {
    "react": ("framework", "React"), "next": ("framework", "Next.js"),
    "express": ("framework", "Express"), "@nestjs/core": ("framework", "NestJS"),
    "vite": ("build", "Vite"), "vitest": ("testing", "Vitest"),
    "@playwright/test": ("testing", "Playwright"), "jest": ("testing", "Jest"),
    "prisma": ("database", "Prisma"), "@prisma/client": ("database", "Prisma"),
    "pg": ("database", "PostgreSQL"), "postgres": ("database", "PostgreSQL"),
    "mongodb": ("database", "MongoDB"), "mongoose": ("database", "MongoDB"),
    "redis": ("external", "Redis"), "ioredis": ("external", "Redis"),
    "stripe": ("external", "Stripe"), "openai": ("external", "OpenAI"),
    "@anthropic-ai/sdk": ("external", "Anthropic"), "@supabase/supabase-js": ("external", "Supabase"),
}

PYTHON_TECH = {
    "fastapi": ("framework", "FastAPI"), "flask": ("framework", "Flask"),
    "django": ("framework", "Django"), "sqlalchemy": ("database", "SQLAlchemy"),
    "psycopg": ("database", "PostgreSQL"), "asyncpg": ("database", "PostgreSQL"),
    "pymongo": ("database", "MongoDB"), "redis": ("external", "Redis"),
    "celery": ("external", "Celery"), "stripe": ("external", "Stripe"),
    "openai": ("external", "OpenAI"), "anthropic": ("external", "Anthropic"),
    "pytest": ("testing", "pytest"),
}


def language_for(path: str) -> str:
    return LANGUAGES.get(PurePosixPath(path).suffix.lower(), "Configuration")


def _read_text(discovery: DiscoveryResult, relative_path: str) -> str | None:
    file = next((item for item in discovery.files if item.relative_path == relative_path), None)
    if not file:
        return None
    try:
        return file.absolute_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _record(target: dict[str, set[str]], category: str, value: str) -> None:
    target[category].add(value)


def fingerprint(discovery: DiscoveryResult) -> dict[str, object]:
    categories: dict[str, set[str]] = defaultdict(set)
    file_counts = Counter(language_for(item.relative_path) for item in discovery.files)
    source_counts = {name: count for name, count in file_counts.items() if name != "Configuration"}

    package_source = _read_text(discovery, "package.json")
    if package_source:
        try:
            package = json.loads(package_source)
            dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
            for dependency in dependencies:
                if dependency in PACKAGE_TECH:
                    _record(categories, *PACKAGE_TECH[dependency])
            if package.get("scripts"):
                categories["tooling"].add("npm scripts")
        except (json.JSONDecodeError, TypeError):
            pass

    requirement_sources = [
        _read_text(discovery, name)
        for name in ("requirements.txt", "pyproject.toml", "Pipfile")
    ]
    requirements = "\n".join(source for source in requirement_sources if source).lower()
    for dependency, value in PYTHON_TECH.items():
        if re.search(rf"(?<![a-z0-9_-]){re.escape(dependency)}(?![a-z0-9_-])", requirements):
            _record(categories, *value)

    names = {item.relative_path for item in discovery.files}
    if "Dockerfile" in names or any(name.startswith("Dockerfile.") for name in names):
        categories["infrastructure"].add("Docker")
    if names.intersection({"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}):
        categories["infrastructure"].add("Docker Compose")
    if any(name.startswith(".github/workflows/") for name in names):
        categories["infrastructure"].add("GitHub Actions")
    if any(name.endswith("schema.prisma") for name in names):
        categories["database"].add("Prisma")
    if any(PurePosixPath(name).name.startswith("next.config.") for name in names):
        categories["framework"].add("Next.js")
    if any(PurePosixPath(name).name.startswith("vite.config.") for name in names):
        categories["build"].add("Vite")

    return {
        "languages": sorted(source_counts),
        "languageFileCounts": dict(sorted(source_counts.items())),
        "frameworks": sorted(categories["framework"]),
        "infrastructure": sorted(categories["infrastructure"]),
        "databases": sorted(categories["database"]),
        "externalSystems": sorted(categories["external"]),
        "testing": sorted(categories["testing"]),
        "buildTools": sorted(categories["build"]),
        "tooling": sorted(categories["tooling"]),
    }


def environment_evidence(contents: Iterable[tuple[str, str]]) -> dict[str, list[dict[str, object]]]:
    patterns = {
        "PostgreSQL": r"\b(?:DATABASE_URL|POSTGRES(?:QL)?_URL|PGHOST)\b",
        "Redis": r"\b(?:REDIS_URL|REDIS_HOST)\b",
        "MongoDB": r"\b(?:MONGO(?:DB)?_URI|MONGODB_URL)\b",
        "Stripe": r"\bSTRIPE_(?:SECRET_KEY|API_KEY|WEBHOOK_SECRET)\b",
        "OpenAI": r"\bOPENAI_API_KEY\b",
        "Anthropic": r"\bANTHROPIC_API_KEY\b",
        "Supabase": r"\bSUPABASE_(?:URL|KEY|ANON_KEY)\b",
        "AWS": r"\bAWS_(?:ACCESS_KEY_ID|REGION|S3_BUCKET)\b",
        "SendGrid": r"\bSENDGRID_API_KEY\b",
        "Resend": r"\bRESEND_API_KEY\b",
        "Twilio": r"\bTWILIO_(?:ACCOUNT_SID|AUTH_TOKEN)\b",
    }
    found: dict[str, list[dict[str, object]]] = defaultdict(list)
    for path, source in contents:
        for name, pattern in patterns.items():
            for match in re.finditer(pattern, source):
                found[name].append({
                    "file": path,
                    "line": source.count("\n", 0, match.start()) + 1,
                    "kind": "environment_variable",
                })
    return dict(found)

