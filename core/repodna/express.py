from __future__ import annotations

import re
from dataclasses import replace

from repodna.model import Diagnostic, ExpressMount, ImportEdge, PartialAnalysis, Route


def _join_route_paths(prefix: str, route_path: str) -> str:
    left = "" if prefix == "/" else f"/{prefix.strip('/')}"
    right = "" if route_path == "/" else f"/{route_path.strip('/')}"
    return f"{left}{right}" or "/"


def _looks_like_router_mount(mount: ExpressMount) -> bool:
    return bool(
        re.search(r"router|routes?|require\s*\(|import\s*\(", mount.target_expression, re.IGNORECASE)
        or re.search(r"route|prefix|path", mount.prefix_expression or "", re.IGNORECASE)
        or (mount.target_module and re.search(r"routes?|router", mount.target_module, re.IGNORECASE))
    )


def _resolve_mount_target(mount: ExpressMount, imports: list[ImportEdge]) -> str | None:
    local_imports = [edge for edge in imports if edge.source == mount.file and edge.target]
    if mount.target_module:
        return next((edge.target for edge in local_imports if edge.module == mount.target_module), None)
    if mount.target_identifier:
        return next((edge.target for edge in local_imports if mount.target_identifier in edge.names), None)
    return None


def _push_diagnostic(diagnostics: list[Diagnostic], diagnostic: Diagnostic) -> None:
    if any(
        item.code == diagnostic.code and item.file == diagnostic.file and item.message == diagnostic.message
        for item in diagnostics
    ):
        return
    diagnostics.append(diagnostic)


def _unresolved_mount_diagnostic(mount: ExpressMount, dynamic: bool) -> Diagnostic:
    arguments = ", ".join(value for value in (mount.prefix_expression, mount.target_expression) if value)
    call = f"{mount.receiver}.use({arguments})"
    if dynamic:
        return Diagnostic(
            severity="warning",
            code="DYNAMIC_ROUTE_MOUNT_UNRESOLVED",
            message=(
                f'Could not resolve dynamic Express mount "{call}" at line {mount.line}; '
                "routes beneath this mount may be missing or have incomplete paths."
            ),
            file=mount.file,
        )
    return Diagnostic(
        severity="warning",
        code="EXPRESS_ROUTE_MOUNT_UNRESOLVED",
        message=(
            f'Could not resolve Express router target "{mount.target_expression}" mounted at '
            f'"{mount.prefix or "/"}" on line {mount.line}; routes beneath this mount may be missing.'
        ),
        file=mount.file,
    )


def resolve_express_route_mounts(
    partials: list[PartialAnalysis],
    imports: list[ImportEdge],
    diagnostics: list[Diagnostic],
) -> list[Route]:
    routes = [route for partial in partials for route in partial.routes]
    mounts = [mount for partial in partials for mount in partial.express_mounts]
    if not mounts:
        return routes

    route_files = {route.file for route in routes if route.framework == "Express"}
    mount_files = {mount.file for mount in mounts}
    resolved: list[tuple[ExpressMount, str, str]] = []

    for mount in mounts:
        target = _resolve_mount_target(mount, imports)
        target_has_route_surface = bool(target and (target in route_files or target in mount_files))
        if target and target_has_route_surface and mount.prefix is not None:
            resolved.append((mount, target, mount.prefix))
            continue
        if _looks_like_router_mount(mount):
            _push_diagnostic(
                diagnostics,
                _unresolved_mount_diagnostic(mount, mount.dynamic or mount.prefix is None),
            )

    if not resolved:
        return routes

    targeted_files = {target for _, target, _ in resolved}
    parent_files = {mount.file for mount, _, _ in resolved}
    prefixes_by_file: dict[str, set[str]] = {
        parent: {""} for parent in parent_files if parent not in targeted_files
    }

    changed = True
    for _ in range(len(resolved) + 1):
        if not changed:
            break
        changed = False
        for mount, target, prefix in resolved:
            parent_prefixes = prefixes_by_file.get(mount.file)
            if not parent_prefixes:
                continue
            target_prefixes = prefixes_by_file.setdefault(target, set())
            for parent_prefix in parent_prefixes:
                mounted_prefix = _join_route_paths(parent_prefix or "/", prefix)
                if mounted_prefix not in target_prefixes:
                    target_prefixes.add(mounted_prefix)
                    changed = True

    for mount, target, _ in resolved:
        if not prefixes_by_file.get(target):
            _push_diagnostic(diagnostics, Diagnostic(
                severity="warning",
                code="EXPRESS_ROUTE_MOUNT_UNRESOLVED",
                message=(
                    f'Resolved router "{mount.target_expression}" but could not establish a root mount path; '
                    "routes beneath it may be incomplete."
                ),
                file=mount.file,
            ))

    expanded: list[Route] = []
    seen: set[str] = set()
    for route in routes:
        prefixes = (
            sorted(prefixes_by_file.get(route.file, set()))
            if route.framework == "Express" and route.file in targeted_files
            else [""]
        )
        for prefix in prefixes or [""]:
            path = _join_route_paths(prefix, route.path) if prefix else route.path
            key = f"{route.method}:{path}:{route.handler}:{route.file}:{route.line}"
            if key in seen:
                continue
            seen.add(key)
            expanded.append(replace(
                route,
                id=route.id if path == route.path else f"route:{route.file}:{route.line}:{route.method}:{path}",
                path=path,
            ))
    return expanded
