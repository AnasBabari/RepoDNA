from __future__ import annotations

from collections import Counter, defaultdict, deque
from pathlib import PurePosixPath
from typing import Iterable

from repodna.model import (
    ArchitectureComponent,
    ArchitectureConnection,
    CallEdge,
    Entrypoint,
    FileRecord,
    ImportEdge,
    PartialAnalysis,
    Route,
    Symbol,
)


COMPONENT_NAMES = {
    "frontend": "Frontend",
    "api": "API layer",
    "services": "Services",
    "domain": "Domain",
    "repositories": "Repositories",
    "database": "Database",
    "workers": "Background workers",
    "infrastructure": "Infrastructure",
    "tests": "Tests",
    "configuration": "Configuration",
    "other": "Application core",
}
COMPONENT_ORDER = [
    "frontend", "api", "services", "domain", "repositories", "database",
    "workers", "infrastructure", "configuration", "tests", "other",
]


def _normalize(path: PurePosixPath) -> str:
    parts: list[str] = []
    for part in path.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def _detect_package_roots(available: set[str]) -> list[str]:
    """Detect package roots like src, lib, backend, or directories with __init__.py."""
    roots: set[str] = set()
    for path in available:
        pure = PurePosixPath(path)
        if pure.name == "__init__.py" and len(pure.parts) > 1:
            roots.add(pure.parts[0])
            if len(pure.parts) > 2 and pure.parts[0] in {"src", "lib", "packages"}:
                roots.add(f"{pure.parts[0]}/{pure.parts[1]}")
        elif pure.parts and pure.parts[0] in {"src", "lib"}:
            roots.add(pure.parts[0])
    return sorted(roots, key=lambda r: len(r.split("/")), reverse=True)


def _resolve_python(
    edge: ImportEdge,
    available: set[str],
    package_roots: list[str] | None = None,
) -> str | None:
    source_parent = PurePosixPath(edge.source).parent
    module = edge.module
    leading = len(module) - len(module.lstrip("."))
    module_parts = [part for part in module.lstrip(".").split(".") if part]

    if leading:
        base = source_parent
        for _ in range(max(0, leading - 1)):
            base = base.parent
        stem = PurePosixPath(base, *module_parts)
        candidates = [
            f"{_normalize(stem)}.py",
            f"{_normalize(stem)}/__init__.py",
            f"{_normalize(stem)}.pyi",
        ]
        for name in edge.names:
            child = PurePosixPath(stem, name)
            candidates.extend([f"{_normalize(child)}.py", f"{_normalize(child)}/__init__.py"])
        return next((c for c in candidates if c in available), None)

    # Absolute import: check root-level first
    stem = PurePosixPath(*module_parts)
    candidates = [
        f"{_normalize(stem)}.py",
        f"{_normalize(stem)}/__init__.py",
        f"{_normalize(stem)}.pyi",
    ]
    for name in edge.names:
        child = PurePosixPath(stem, name)
        candidates.extend([f"{_normalize(child)}.py", f"{_normalize(child)}/__init__.py"])
    match = next((c for c in candidates if c in available), None)
    if match:
        return match

    # Check detected package roots (e.g. src/mypkg -> mypkg)
    if package_roots:
        for root in package_roots:
            rooted_stem = PurePosixPath(root, *module_parts)
            rooted_candidates = [
                f"{_normalize(rooted_stem)}.py",
                f"{_normalize(rooted_stem)}/__init__.py",
                f"{_normalize(rooted_stem)}.pyi",
            ]
            for name in edge.names:
                child = PurePosixPath(rooted_stem, name)
                rooted_candidates.extend([f"{_normalize(child)}.py", f"{_normalize(child)}/__init__.py"])
            match = next((c for c in rooted_candidates if c in available), None)
            if match:
                return match

    return None


def _resolve_javascript(
    edge: ImportEdge,
    available: set[str],
    path_aliases: dict[str, str] | None = None,
) -> str | None:
    extensions = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json")
    module = edge.module

    # 1. Relative imports
    if module.startswith("."):
        stem = PurePosixPath(PurePosixPath(edge.source).parent, module)
        normalized = _normalize(stem)
        candidates = [normalized, *(normalized + ext for ext in extensions)]
        candidates.extend(f"{normalized}/index{ext}" for ext in extensions)
        return next((c for c in candidates if c in available), None)

    # 2. Path aliases (from tsconfig.json / jsconfig.json)
    if path_aliases:
        for prefix, dest in path_aliases.items():
            if prefix and (module == prefix or module.startswith(prefix + "/")):
                subpath = module[len(prefix):].lstrip("/")
                stem = PurePosixPath(dest, subpath) if dest else PurePosixPath(subpath)
                normalized = _normalize(stem)
                candidates = [normalized, *(normalized + ext for ext in extensions)]
                candidates.extend(f"{normalized}/index{ext}" for ext in extensions)
                match = next((c for c in candidates if c in available), None)
                if match:
                    return match

    return None


def resolve_imports(
    imports: list[ImportEdge],
    files: list[FileRecord],
    path_aliases: dict[str, str] | None = None,
) -> None:
    available = {file.path for file in files}
    package_roots = _detect_package_roots(available)

    for edge in imports:
        if edge.source.endswith((".py", ".pyi")):
            edge.target = _resolve_python(edge, available, package_roots)
            edge.external = edge.target is None and not edge.module.startswith(".")
        else:
            edge.target = _resolve_javascript(edge, available, path_aliases)
            edge.external = edge.target is None and not edge.module.startswith(".")


def resolve_calls(
    calls: list[CallEdge],
    symbols: list[Symbol],
    imports: list[ImportEdge] | None = None,
) -> None:
    by_name: dict[str, list[Symbol]] = defaultdict(list)
    by_file_and_name: dict[tuple[str, str], list[Symbol]] = defaultdict(list)
    for symbol in symbols:
        if symbol.type != "module":
            by_name[symbol.name].append(symbol)
            by_file_and_name[(symbol.file, symbol.name)].append(symbol)

    # Build file-to-imported-target-files map
    imported_targets_by_file: dict[str, set[str]] = defaultdict(set)
    if imports:
        for edge in imports:
            if edge.target:
                imported_targets_by_file[edge.source].add(edge.target)

    for edge in calls:
        callee = edge.callee
        name = callee.rsplit(".", 1)[-1]

        # 1. Check if callee is imported from another file
        if "." in callee and edge.file in imported_targets_by_file:
            qualifier = callee.split(".", 1)[0]
            for target_file in imported_targets_by_file[edge.file]:
                # Look for qualifier::name or direct symbol name in target file
                matched_in_target = by_file_and_name.get((target_file, name), [])
                if not matched_in_target:
                    # Check if qualifier matches class or namespace
                    matched_in_target = [s for s in symbols if s.file == target_file and s.name == name]
                if len(matched_in_target) == 1:
                    edge.target = matched_in_target[0].id
                    edge.confidence = 0.92
                    break
            if edge.target:
                continue

        # 2. Local same-file match
        same_file = by_file_and_name.get((edge.file, name), [])
        if len(same_file) == 1:
            edge.target = same_file[0].id
            edge.confidence = 0.88
            continue

        # 3. Global unambiguous match
        matches = by_name.get(name, [])
        if len(matches) == 1:
            edge.target = matches[0].id
            edge.confidence = 0.82 if "." in edge.callee else 0.72


def classify_file(path: str, route_files: set[str], symbol_types: set[str]) -> tuple[str, list[str]]:
    lowered = path.lower()
    parts = set(PurePosixPath(lowered).parts)
    evidence: list[str] = []

    if "tests" in parts or "test" in parts or lowered.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", "_test.py", "test.py")):
        return "tests", ["test path or filename"]
    if path in route_files or parts.intersection({"api", "routes", "routers", "controllers", "endpoints"}):
        evidence.append("contains or groups request handlers")
        return "api", evidence
    if parts.intersection({"services", "service", "usecases", "use_cases"}):
        return "services", ["service or use-case path"]
    if parts.intersection({"repositories", "repository", "dao"}):
        return "repositories", ["repository or DAO path"]
    if parts.intersection({"models", "database", "db", "migrations", "schema", "entities"}) or "database_model" in symbol_types:
        return "database", ["database path or ORM model evidence"]
    if parts.intersection({"workers", "worker", "jobs", "tasks", "queues"}):
        return "workers", ["worker, job, or queue path"]
    if parts.intersection({"frontend", "client", "components", "pages", "views", "ui"}) or "component" in symbol_types:
        return "frontend", ["frontend path or component symbols"]
    if parts.intersection({"domain", "core"}):
        return "domain", ["domain or core path"]
    if parts.intersection({"infra", "infrastructure", ".github", "deploy"}) or PurePosixPath(path).name in {"Dockerfile", "docker-compose.yml", "compose.yml"}:
        return "infrastructure", ["infrastructure manifest or path"]
    if PurePosixPath(path).suffix.lower() in {".json", ".toml", ".yaml", ".yml", ".ini", ".cfg"}:
        return "configuration", ["configuration file"]
    if parts.intersection({"src", "app"}):
        return "frontend", ["frontend container path"]
    return "other", ["source file outside a recognized layer"]


def build_architecture(
    files: list[FileRecord],
    symbols: list[Symbol],
    imports: list[ImportEdge],
    routes: list[Route],
) -> tuple[dict[str, object], dict[str, str]]:
    route_files = {route.file for route in routes}
    symbol_types_by_file: dict[str, set[str]] = defaultdict(set)
    for symbol in symbols:
        symbol_types_by_file[symbol.file].add(symbol.type)

    groups: dict[str, list[str]] = defaultdict(list)
    evidence: dict[str, set[str]] = defaultdict(set)
    file_component: dict[str, str] = {}

    for file in files:
        component, reasons = classify_file(file.path, route_files, symbol_types_by_file[file.path])
        groups[component].append(file.path)
        evidence[component].update(reasons)
        file_component[file.path] = component

    components: list[ArchitectureComponent] = []
    for component_type in COMPONENT_ORDER:
        paths = groups.get(component_type)
        if not paths:
            continue
        confidence = 0.94 if component_type in {"api", "database", "tests"} else 0.82
        components.append(ArchitectureComponent(
            id=component_type,
            name=COMPONENT_NAMES[component_type],
            type=component_type,
            files=sorted(paths),
            confidence=confidence,
            evidence=sorted(evidence[component_type]),
        ))

    connection_counts: Counter[tuple[str, str]] = Counter()
    for edge in imports:
        if not edge.target:
            continue
        source = file_component.get(edge.source)
        target = file_component.get(edge.target)
        if source and target and source != target:
            connection_counts[(source, target)] += 1

    connections = [
        ArchitectureConnection(
            id=f"component:{source}:{target}",
            source=source,
            target=target,
            type="imports",
            weight=weight,
        )
        for (source, target), weight in sorted(connection_counts.items())
    ]

    return {
        "components": [component.__dict__ if hasattr(component, "__dict__") else {
            "id": component.id, "name": component.name, "type": component.type,
            "files": component.files, "confidence": component.confidence, "evidence": component.evidence,
        } for component in components],
        "connections": [
            {"id": edge.id, "source": edge.source, "target": edge.target, "type": edge.type, "weight": edge.weight}
            for edge in connections
        ],
    }, file_component


def rank_entrypoints(files: list[FileRecord], partials: list[PartialAnalysis]) -> list[Entrypoint]:
    evidence_by_file: dict[str, list[str]] = defaultdict(list)
    for partial in partials:
        evidence_by_file[partial.file.path].extend(partial.entrypoint_evidence)

    conventional = {
        "main.py": 30, "__main__.py": 35, "app.py": 24, "server.py": 25, "wsgi.py": 20, "asgi.py": 22,
        "index.js": 22, "index.ts": 22, "server.js": 28, "server.ts": 28,
        "main.js": 24, "main.ts": 24, "main.tsx": 26,
    }
    entries: list[Entrypoint] = []
    for file in files:
        reasons = list(dict.fromkeys(evidence_by_file[file.path]))
        score = conventional.get(PurePosixPath(file.path).name, 0) + 35 * len(reasons)
        if not score:
            continue
        if PurePosixPath(file.path).name in conventional:
            reasons.append(f"uses the conventional {PurePosixPath(file.path).name} filename")
        entries.append(Entrypoint(
            id=f"entrypoint:{file.path}",
            file=file.path,
            kind="application",
            score=score,
            confidence=min(0.99, 0.45 + score / 150),
            evidence=list(dict.fromkeys(reasons)),
        ))
    return sorted(entries, key=lambda item: (-item.score, item.file))[:10]


def build_flows(routes: list[Route], calls: list[CallEdge], symbols: list[Symbol], limit: int = 12) -> list[dict[str, object]]:
    outgoing: dict[str, list[CallEdge]] = defaultdict(list)
    for call in calls:
        if call.target:
            outgoing[call.source].append(call)

    symbol_by_id = {symbol.id: symbol for symbol in symbols}
    flows: list[dict[str, object]] = []

    for route in routes:
        nodes = [{"id": route.id, "type": "route", "label": f"{route.method} {route.path}", "file": route.file, "line": route.line}]
        edges: list[dict[str, str]] = []
        visited = {route.handler}
        queue: deque[tuple[str, int]] = deque([(route.handler, 0)])

        handler_symbol = symbol_by_id.get(route.handler)
        if handler_symbol:
            nodes.append({"id": handler_symbol.id, "type": handler_symbol.type, "label": handler_symbol.name, "file": handler_symbol.file, "line": handler_symbol.line})
            edges.append({"source": route.id, "target": handler_symbol.id, "type": "handles"})

        while queue and len(nodes) < limit:
            source, depth = queue.popleft()
            if depth >= 5:
                continue
            for call in outgoing.get(source, []):
                if not call.target or call.target in visited:
                    continue
                visited.add(call.target)
                target = symbol_by_id.get(call.target)
                if target:
                    nodes.append({"id": target.id, "type": target.type, "label": target.name, "file": target.file, "line": target.line})
                    edges.append({"source": source, "target": target.id, "type": "calls"})
                    queue.append((target.id, depth + 1))
                if len(nodes) >= limit:
                    break

        flows.append({
            "id": f"flow:{route.id}",
            "name": f"{route.method} {route.path}",
            "confidence": 0.86 if len(nodes) > 1 else 0.6,
            "nodes": nodes,
            "edges": edges,
        })
    return flows


def _dependency_cycles(imports: list[ImportEdge]) -> list[list[str]]:
    graph: dict[str, set[str]] = defaultdict(set)
    for edge in imports:
        if edge.target:
            graph[edge.source].add(edge.target)
    cycles: set[tuple[str, ...]] = set()
    active: list[str] = []
    active_set: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> None:
        if node in active_set:
            start = active.index(node)
            cycle = active[start:]
            if cycle:
                rotations = [tuple(cycle[index:] + cycle[:index]) for index in range(len(cycle))]
                cycles.add(min(rotations))
            return
        if node in visited:
            return
        visited.add(node)
        active.append(node)
        active_set.add(node)
        for target in graph.get(node, set()):
            visit(target)
        active.pop()
        active_set.remove(node)

    for node in sorted(graph):
        visit(node)
    return [list(cycle) for cycle in sorted(cycles)]


def rank_important_files(
    files: list[FileRecord],
    imports: list[ImportEdge],
    routes: list[Route],
    entrypoints: list[Entrypoint],
) -> list[dict[str, object]]:
    inbound = Counter(edge.target for edge in imports if edge.target)
    outbound = Counter(edge.source for edge in imports if edge.target)
    route_count = Counter(route.file for route in routes)
    entry_scores = {entry.file: entry.score for entry in entrypoints}
    ranked: list[dict[str, object]] = []

    for file in files:
        config_weight = 12 if PurePosixPath(file.path).name in {"package.json", "pyproject.toml", "Dockerfile", "tsconfig.json"} else 0
        score = inbound[file.path] * 3 + outbound[file.path] * 2 + route_count[file.path] * 8 + entry_scores.get(file.path, 0) + config_weight
        if score:
            reasons = []
            if entry_scores.get(file.path): reasons.append("entrypoint candidate")
            if route_count[file.path]: reasons.append(f"defines {route_count[file.path]} route(s)")
            if inbound[file.path]: reasons.append(f"imported by {inbound[file.path]} file(s)")
            if outbound[file.path]: reasons.append(f"imports {outbound[file.path]} local file(s)")
            if config_weight: reasons.append("project configuration")
            ranked.append({"file": file.path, "score": score, "reasons": reasons})
    return sorted(ranked, key=lambda item: (-int(item["score"]), str(item["file"])))[:20]


def onboarding_tour(
    entrypoints: list[Entrypoint],
    architecture: dict[str, object],
    important_files: list[dict[str, object]],
) -> list[dict[str, object]]:
    steps: list[dict[str, object]] = []
    if entrypoints:
        entry = entrypoints[0]
        steps.append({"title": "Start at the entry point", "file": entry.file, "description": "; ".join(entry.evidence[:2])})

    descriptions = {
        "api": "Requests enter the application through these handlers.",
        "services": "Business behavior is coordinated in this layer.",
        "domain": "Core concepts and rules live here.",
        "repositories": "Persistence access is isolated here.",
        "database": "Models, schema, and database wiring live here.",
        "workers": "Asynchronous and long-running work begins here.",
    }
    components = architecture.get("components", [])
    for component in components:
        component_type = component.get("type")
        files = component.get("files") or []
        if component_type in descriptions and files:
            steps.append({
                "title": f"Explore {component.get('name')}",
                "file": files[0],
                "description": descriptions[component_type],
            })
        if len(steps) >= 6:
            break

    for item in important_files:
        if len(steps) >= 6:
            break
        if not any(step.get("file") == item["file"] for step in steps):
            steps.append({"title": "Read a central file", "file": item["file"], "description": ", ".join(item["reasons"][:2])})

    for index, step in enumerate(steps, 1):
        step["step"] = index
    return steps


def graph_metrics(files: list[FileRecord], imports: list[ImportEdge], symbols: list[Symbol]) -> dict[str, object]:
    inbound = Counter(edge.target for edge in imports if edge.target)
    outbound = Counter(edge.source for edge in imports if edge.target)
    cycles = _dependency_cycles(imports)
    most_connected = sorted(
        ({"file": file.path, "connections": inbound[file.path] + outbound[file.path]} for file in files),
        key=lambda item: (-item["connections"], item["file"]),
    )
    connections = sum(1 for edge in imports if edge.target)
    complexity = min(100, round(len(files) * 0.15 + len(symbols) * 0.04 + connections * 0.1 + len(cycles) * 5))
    return {
        "complexityScore": complexity,
        "localDependencies": connections,
        "externalDependencies": sum(1 for edge in imports if edge.external),
        "dependencyCycles": cycles,
        "mostConnectedFiles": most_connected[:10],
        "highCouplingFiles": [item for item in most_connected if item["connections"] > 20],
    }


def impact_slice(query: str, symbols: Iterable[Symbol], imports: Iterable[ImportEdge], calls: Iterable[CallEdge]) -> dict[str, object]:
    query_lower = query.lower()
    matching_symbols = [symbol for symbol in symbols if query_lower in symbol.name.lower() or query_lower in symbol.id.lower()]
    ids = {symbol.id for symbol in matching_symbols}
    files = {symbol.file for symbol in matching_symbols}
    dependents = {
        edge.source for edge in imports if edge.target in files
    } | {
        edge.source for edge in calls if edge.target in ids
    }
    return {
        "query": query,
        "matches": [{"id": symbol.id, "name": symbol.name, "file": symbol.file, "line": symbol.line, "type": symbol.type} for symbol in matching_symbols],
        "dependents": sorted(dependents),
    }
