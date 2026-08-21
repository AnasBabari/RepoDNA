from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import PurePosixPath
from typing import Iterable

try:
    import tomllib  # Python 3.11+
except ImportError:
    try:
        import tomli as tomllib  # Fallback for Python < 3.11
    except ImportError:
        tomllib = None  # type: ignore


from repodna.ingestion import DiscoveryResult


LANGUAGES = {
    ".py": "Python", ".pyi": "Python", ".js": "JavaScript", ".jsx": "JavaScript",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
    ".sql": "SQL", ".prisma": "Prisma", ".html": "HTML", ".css": "CSS", ".scss": "SCSS",
    ".json": "Configuration", ".toml": "Configuration", ".yaml": "Configuration", ".yml": "Configuration",
    ".md": "Markdown", ".mdx": "Markdown", ".graphql": "GraphQL", ".gql": "GraphQL",
    ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell",
}

PACKAGE_TECH = {
    # Web & UI Frameworks
    "react": ("framework", "React"), "next": ("framework", "Next.js"),
    "express": ("framework", "Express"), "@nestjs/core": ("framework", "NestJS"),
    "vue": ("framework", "Vue"), "nuxt": ("framework", "Nuxt"),
    "svelte": ("framework", "Svelte"), "@sveltejs/kit": ("framework", "SvelteKit"),
    "astro": ("framework", "Astro"), "remix": ("framework", "Remix"),
    "@remix-run/react": ("framework", "Remix"), "solid-js": ("framework", "SolidJS"),
    "hono": ("framework", "Hono"), "fastify": ("framework", "Fastify"),
    "koa": ("framework", "Koa"), "@trpc/server": ("framework", "tRPC"),
    "gatsby": ("framework", "Gatsby"), "electron": ("framework", "Electron"),

    # Build & Tooling
    "vite": ("build", "Vite"), "webpack": ("build", "Webpack"),
    "rollup": ("build", "Rollup"), "esbuild": ("build", "esbuild"),
    "turbo": ("build", "Turborepo"), "tailwindcss": ("tooling", "Tailwind CSS"),
    "@tailwindcss/postcss": ("tooling", "Tailwind CSS"),

    # Testing
    "vitest": ("testing", "Vitest"), "@playwright/test": ("testing", "Playwright"),
    "playwright": ("testing", "Playwright"), "jest": ("testing", "Jest"),
    "cypress": ("testing", "Cypress"), "mocha": ("testing", "Mocha"),
    "@testing-library/react": ("testing", "Testing Library"),

    # Databases & ORMs
    "prisma": ("database", "Prisma"), "@prisma/client": ("database", "Prisma"),
    "drizzle-orm": ("database", "Drizzle ORM"), "typeorm": ("database", "TypeORM"),
    "knex": ("database", "Knex"), "kysely": ("database", "Kysely"),
    "mikro-orm": ("database", "MikroORM"),
    "pg": ("database", "PostgreSQL"), "postgres": ("database", "PostgreSQL"),
    "mysql": ("database", "MySQL"), "mysql2": ("database", "MySQL"),
    "sqlite3": ("database", "SQLite"), "better-sqlite3": ("database", "SQLite"),
    "mongodb": ("database", "MongoDB"), "mongoose": ("database", "MongoDB"),

    # External APIs, Message Brokers & Cloud
    "redis": ("external", "Redis"), "ioredis": ("external", "Redis"),
    "stripe": ("external", "Stripe"), "openai": ("external", "OpenAI"),
    "@anthropic-ai/sdk": ("external", "Anthropic"), "@supabase/supabase-js": ("external", "Supabase"),
    "firebase": ("external", "Firebase"), "firebase-admin": ("external", "Firebase"),
    "kafkajs": ("external", "Kafka"), "amqplib": ("external", "RabbitMQ"),
    "graphql": ("external", "GraphQL"), "@apollo/server": ("external", "GraphQL"),
    "@apollo/client": ("external", "GraphQL"), "@grpc/grpc-js": ("external", "gRPC"),
    "twilio": ("external", "Twilio"), "resend": ("external", "Resend"),
    "@sendgrid/mail": ("external", "SendGrid"), "@aws-sdk/client-s3": ("external", "AWS"),
}

PYTHON_TECH = {
    # Web Frameworks
    "fastapi": ("framework", "FastAPI"), "flask": ("framework", "Flask"),
    "django": ("framework", "Django"), "tornado": ("framework", "Tornado"),
    "sanic": ("framework", "Sanic"), "litestar": ("framework", "Litestar"),
    "starlette": ("framework", "Starlette"),

    # Databases & ORMs
    "sqlalchemy": ("database", "SQLAlchemy"), "sqlmodel": ("database", "SQLModel"),
    "tortoise-orm": ("database", "Tortoise ORM"), "peewee": ("database", "Peewee"),
    "beanie": ("database", "Beanie"), "motor": ("database", "MongoDB"),
    "pymongo": ("database", "MongoDB"), "alembic": ("database", "Alembic"),
    "psycopg": ("database", "PostgreSQL"), "psycopg2": ("database", "PostgreSQL"),
    "psycopg2-binary": ("database", "PostgreSQL"), "asyncpg": ("database", "PostgreSQL"),
    "aiomysql": ("database", "MySQL"), "aiosqlite": ("database", "SQLite"),

    # External & Async
    "redis": ("external", "Redis"), "celery": ("external", "Celery"),
    "stripe": ("external", "Stripe"), "openai": ("external", "OpenAI"),
    "anthropic": ("external", "Anthropic"), "supabase": ("external", "Supabase"),
    "boto3": ("external", "AWS"), "pika": ("external", "RabbitMQ"),
    "aiokafka": ("external", "Kafka"), "kafka-python": ("external", "Kafka"),
    "grpcio": ("external", "gRPC"), "strawberry-graphql": ("external", "GraphQL"),
    "graphene": ("external", "GraphQL"), "sendgrid": ("external", "SendGrid"),
    "resend": ("external", "Resend"), "twilio": ("external", "Twilio"),
    "httpx": ("external", "HTTPX"), "aiohttp": ("external", "aiohttp"),

    # Testing & Tooling
    "pytest": ("testing", "pytest"), "unittest": ("testing", "unittest"),
    "ruff": ("tooling", "Ruff"), "mypy": ("tooling", "mypy"),
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


def parse_tsconfig_paths(discovery: DiscoveryResult) -> dict[str, str]:
    """Parse path aliases from tsconfig.json or jsconfig.json."""
    for config_name in ("tsconfig.json", "jsconfig.json"):
        content = _read_text(discovery, config_name)
        if not content:
            continue
        try:
            # Strip single-line and multi-line comments from tsconfig
            cleaned = re.sub(r"//.*?\n|/\*.*?\*/", "\n", content)
            # Remove trailing commas before closing braces/brackets
            cleaned = re.sub(r",\s*([\]}])", r"\1", cleaned)
            data = json.loads(cleaned)
            compiler_opts = data.get("compilerOptions", {})
            base_url = compiler_opts.get("baseUrl", ".").rstrip("/")
            paths = compiler_opts.get("paths", {})
            aliases: dict[str, str] = {}
            for alias_key, targets in paths.items():
                if not isinstance(targets, list) or not targets:
                    continue
                target = targets[0]
                # Normalize wildcard patterns like "@/*" -> ["src/*"]
                prefix = alias_key.rstrip("*").rstrip("/")
                dest = target.rstrip("*").rstrip("/")
                if base_url and base_url != ".":
                    dest = f"{base_url}/{dest}".lstrip("./")
                else:
                    dest = dest.lstrip("./")
                aliases[prefix] = dest
            if aliases:
                return aliases
        except (json.JSONDecodeError, TypeError, AttributeError):
            continue
    return {}


def fingerprint(discovery: DiscoveryResult) -> dict[str, object]:
    categories: dict[str, set[str]] = defaultdict(set)
    file_counts = Counter(language_for(item.relative_path) for item in discovery.files)
    source_counts = {name: count for name, count in file_counts.items() if name not in {"Configuration", "Markdown"}}

    package_source = _read_text(discovery, "package.json")
    if package_source:
        try:
            package = json.loads(package_source)
            dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
            for dependency in dependencies:
                # Match exact name or scope prefix
                if dependency in PACKAGE_TECH:
                    _record(categories, *PACKAGE_TECH[dependency])
                else:
                    scope = dependency.split("/")[0] if dependency.startswith("@") else None
                    if scope and scope in PACKAGE_TECH:
                        _record(categories, *PACKAGE_TECH[scope])
            if package.get("scripts"):
                categories["tooling"].add("npm scripts")
        except (json.JSONDecodeError, TypeError):
            pass

    # Parse pyproject.toml with tomllib if available
    pyproject_source = _read_text(discovery, "pyproject.toml")
    parsed_pyproject_deps = False
    if pyproject_source and tomllib is not None:
        try:
            pyproject_data = tomllib.loads(pyproject_source)
            project_data = pyproject_data.get("project", {})
            deps_list = list(project_data.get("dependencies", []))
            for opt_deps in project_data.get("optional-dependencies", {}).values():
                if isinstance(opt_deps, list):
                    deps_list.extend(opt_deps)
            poetry_deps = pyproject_data.get("tool", {}).get("poetry", {}).get("dependencies", {})
            if isinstance(poetry_deps, dict):
                deps_list.extend(poetry_deps.keys())
            for raw_dep in deps_list:
                clean_dep = re.split(r"[><=~!;\[]", str(raw_dep))[0].strip().lower()
                if clean_dep in PYTHON_TECH:
                    _record(categories, *PYTHON_TECH[clean_dep])
            parsed_pyproject_deps = True
        except Exception:
            pass

    # Parse requirements.txt and Pipfile
    requirement_sources = [
        _read_text(discovery, name)
        for name in ("requirements.txt", "Pipfile")
    ]
    if not parsed_pyproject_deps and pyproject_source:
        requirement_sources.append(pyproject_source)

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
    if any(PurePosixPath(name).name.startswith("tailwind.config.") for name in names):
        categories["tooling"].add("Tailwind CSS")

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
        # Avoid scanning markdown documentation files to prevent false positive env var evidence
        if path.lower().endswith((".md", ".mdx", ".txt", ".rst")):
            continue
        for name, pattern in patterns.items():
            for match in re.finditer(pattern, source):
                found[name].append({
                    "file": path,
                    "line": source.count("\n", 0, match.start()) + 1,
                    "kind": "environment_variable",
                })
    return dict(found)
