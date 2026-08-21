from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any

from repodna.analyzers import JavaScriptAnalyzer, PythonAnalyzer
from repodna.cache import AnalysisCache
from repodna.detection import environment_evidence, fingerprint, language_for
from repodna.graph import (
    build_architecture,
    build_flows,
    graph_metrics,
    onboarding_tour,
    rank_entrypoints,
    rank_important_files,
    resolve_calls,
    resolve_imports,
)
from repodna.ingestion import IngestionLimits, repository_source
from repodna.model import AnalysisResult, Diagnostic, FileRecord, PartialAnalysis


ANALYZERS = (PythonAnalyzer(), JavaScriptAnalyzer())


def _read_source(path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _file_record(relative: str, source: str, size: int) -> FileRecord:
    return FileRecord(
        id=f"file:{relative}",
        path=relative,
        language=language_for(relative),
        lines=max(1, source.count("\n") + 1),
        bytes=size,
        hash=hashlib.sha256(source.encode("utf-8", errors="replace")).hexdigest(),
    )


def _resolve_manifest_target(manifest_path: str, candidate: str, available: set[str]) -> str | None:
    parent = PurePosixPath(manifest_path).parent
    cleaned = candidate.strip("'\"").lstrip("./")
    joined = (parent / cleaned).as_posix() if str(parent) != "." else cleaned
    candidates = [joined]
    if not PurePosixPath(joined).suffix:
        candidates.extend(joined + extension for extension in (".js", ".ts", ".tsx", ".py"))
        candidates.extend(f"{joined}/index{extension}" for extension in (".js", ".ts", ".tsx"))
    return next((path for path in candidates if path in available), None)


def _apply_manifest_entrypoints(partials: list[PartialAnalysis], contents: list[tuple[str, str]]) -> None:
    by_file = {partial.file.path: partial for partial in partials}
    available = set(by_file)
    source_extensions = r"(?:py|js|mjs|cjs|ts|tsx|jsx)"
    for path, source in contents:
        name = PurePosixPath(path).name
        candidates: list[tuple[str, str]] = []
        if name == "package.json":
            try:
                package = json.loads(source)
            except (json.JSONDecodeError, TypeError):
                continue
            for field in ("main", "module"):
                if isinstance(package.get(field), str):
                    candidates.append((package[field], f"package {field} points here"))
            scripts = package.get("scripts", {})
            if isinstance(scripts, dict):
                for script_name in ("start", "dev", "serve"):
                    command = scripts.get(script_name)
                    if not isinstance(command, str):
                        continue
                    for match in re.finditer(rf"(?P<path>[A-Za-z0-9_./-]+\.{source_extensions})", command):
                        candidates.append((match.group("path"), f"package {script_name} script starts this file"))
        elif name == "Dockerfile":
            for match in re.finditer(rf"(?P<path>[A-Za-z0-9_./-]+\.{source_extensions})", source):
                candidates.append((match.group("path"), "Docker CMD or ENTRYPOINT references this file"))
        for candidate, reason in candidates:
            resolved = _resolve_manifest_target(path, candidate, available)
            if resolved and reason not in by_file[resolved].entrypoint_evidence:
                by_file[resolved].entrypoint_evidence.append(reason)


def _technology_records(
    names: set[str],
    category: str,
    partials: list[PartialAnalysis],
    environment: dict[str, list[dict[str, object]]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for name in sorted(names):
        evidence: list[dict[str, object]] = []
        for partial in partials:
            values = partial.databases if category == "database" else partial.externals
            if name in values:
                evidence.append({"file": partial.file.path, "kind": "source_usage"})
        evidence.extend(environment.get(name, []))
        records.append({
            "name": name,
            "type": category,
            "confidence": 0.95 if evidence else 0.72,
            "evidence": evidence[:20],
        })
    return records


def analyze_repository(
    source: str,
    *,
    max_files: int = 10_000,
    max_file_bytes: int = 1_000_000,
    cache_path: Path | None = None,
) -> AnalysisResult:
    limits = IngestionLimits(max_files=max_files, max_file_bytes=max_file_bytes)
    cache = AnalysisCache(cache_path)
    with repository_source(source, limits) as discovery:
        fingerprint_data = fingerprint(discovery)
        files: list[FileRecord] = []
        partials: list[PartialAnalysis] = []
        contents: list[tuple[str, str]] = []
        diagnostics: list[Diagnostic] = [
            Diagnostic(
                severity="info",
                code=f"skipped_{item['reason']}",
                message=f"Skipped {item['path']}: {item['reason']}",
                file=item["path"] if item["path"] != "*" else None,
            )
            for item in discovery.skipped
        ]

        for discovered in discovery.files:
            try:
                text = _read_source(discovered.absolute_path)
            except OSError as exc:
                diagnostics.append(Diagnostic("warning", "read_error", str(exc), discovered.relative_path))
                continue
            file = _file_record(discovered.relative_path, text, discovered.size)
            files.append(file)
            contents.append((discovered.relative_path, text))
            partial = cache.restore(file)
            if partial is None:
                analyzer = next((candidate for candidate in ANALYZERS if candidate.supports(discovered.absolute_path)), None)
                if analyzer:
                    partial = analyzer.analyze(file, text)
                else:
                    partial = PartialAnalysis(file=file)
            partials.append(partial)
            if file.error:
                diagnostics.append(Diagnostic("warning", "parse_error", file.error, file.path))

        _apply_manifest_entrypoints(partials, contents)
        cache.store(partials)
        symbols = [symbol for partial in partials for symbol in partial.symbols]
        imports = [edge for partial in partials for edge in partial.imports]
        calls = [edge for partial in partials for edge in partial.calls]
        routes = [route for partial in partials for route in partial.routes]
        resolve_imports(imports, files)
        resolve_calls(calls, symbols)

        entrypoints = rank_entrypoints(files, partials)
        architecture, file_components = build_architecture(files, symbols, imports, routes)
        flows = build_flows(routes, calls, symbols)
        important_files = rank_important_files(files, imports, routes, entrypoints)
        onboarding = onboarding_tour(entrypoints, architecture, important_files)
        metrics = graph_metrics(files, imports, symbols)

        environment = environment_evidence(contents)
        frameworks = set(fingerprint_data.get("frameworks", []))
        databases = set(fingerprint_data.get("databases", []))
        externals = set(fingerprint_data.get("externalSystems", []))
        for partial in partials:
            frameworks.update(partial.frameworks)
            databases.update(partial.databases)
            externals.update(partial.externals)
        for path, text in contents:
            if PurePosixPath(path).suffix.lower() == ".sql" or re.search(r"\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b", text, re.IGNORECASE):
                databases.add("SQL database")
        databases.update(name for name in environment if name in {"PostgreSQL", "MongoDB", "Supabase"})
        externals.update(name for name in environment if name not in databases)
        if "SQL database" in databases and databases.intersection({"PostgreSQL", "MySQL", "SQLite"}):
            databases.remove("SQL database")

        language_lines = Counter()
        for file in files:
            if file.language != "Configuration":
                language_lines[file.language] += file.lines
        total_language_lines = sum(language_lines.values()) or 1
        language_percentages = {
            name: round(lines / total_language_lines * 100, 1)
            for name, lines in language_lines.most_common()
        }
        technologies = sorted({
            *frameworks,
            *databases,
            *externals,
            *fingerprint_data.get("infrastructure", []),
            *fingerprint_data.get("testing", []),
            *fingerprint_data.get("buildTools", []),
        })

        parsed_count = sum(file.parsed for file in files)
        source_count = sum(file.language in {"Python", "JavaScript", "TypeScript"} for file in files)
        repository = {
            "name": discovery.name,
            "source": discovery.source,
            "languages": language_percentages,
            "fileCount": len(files),
            "sourceFileCount": source_count,
            "parsedFileCount": parsed_count,
            "lines": sum(file.lines for file in files),
            "fingerprint": fingerprint_data,
        }
        metrics.update({
            "symbols": len(symbols),
            "routes": len(routes),
            "components": len(architecture.get("components", [])),
            "parseSuccessRate": round((parsed_count / source_count * 100), 1) if source_count else 100.0,
        })

        return AnalysisResult(
            repository=repository,
            technologies=technologies,
            files=files,
            symbols=symbols,
            imports=imports,
            calls=calls,
            routes=routes,
            databases=_technology_records(databases, "database", partials, environment),
            external_systems=_technology_records(externals, "external_system", partials, environment),
            entrypoints=entrypoints,
            flows=flows,
            architecture=architecture,
            important_files=important_files,
            onboarding=onboarding,
            metrics=metrics,
            diagnostics=diagnostics,
            metadata={
                "analysisMode": "static",
                "executedRepositoryCode": False,
                "limits": {"maxFiles": max_files, "maxFileBytes": max_file_bytes},
                "fileComponents": file_components,
                "cache": {"hits": cache.hits, "misses": cache.misses},
            },
        )
