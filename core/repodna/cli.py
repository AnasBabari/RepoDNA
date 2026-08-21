from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from repodna import __version__
from repodna.engine import analyze_repository
from repodna.graph import impact_slice
from repodna.ingestion import IngestionError
from repodna.model import CallEdge, ImportEdge, Symbol


def _load_project(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Could not read RepoDNA project file {path}: {exc}") from exc


def _analyse(args: argparse.Namespace) -> int:
    try:
        target = Path(args.output)
        result = analyze_repository(
            args.source,
            max_files=args.max_files,
            max_file_bytes=args.max_file_bytes,
            cache_path=target.parent / "cache.json",
        )
    except IngestionError as exc:
        print(f"RepoDNA could not analyse the repository: {exc}", file=sys.stderr)
        return 2
    result.write_json(target)
    repository = result.repository
    print(f"✓ {repository['fileCount']} files discovered")
    print(f"✓ {repository['parsedFileCount']} source files parsed")
    print(f"✓ {len(result.symbols)} symbols indexed")
    print(f"✓ {result.metrics['localDependencies']} dependencies mapped")
    print(f"✓ {len(result.routes)} routes discovered")
    print(f"✓ {len(result.architecture['components'])} architecture components generated")
    cache = result.metadata.get("cache", {})
    if cache.get("hits"):
        print(f"✓ {cache['hits']} unchanged files reused from cache")
    if result.diagnostics:
        print(f"! {len(result.diagnostics)} file diagnostics recorded")
    print(f"\nOutput: {target.resolve()}")
    return 0


def _trace(args: argparse.Namespace) -> int:
    project = _load_project(Path(args.project))
    query = args.query.lower()
    flows = [
        flow for flow in project.get("flows", [])
        if query in str(flow.get("name", "")).lower()
        or any(query in str(node.get("label", "")).lower() for node in flow.get("nodes", []))
    ]
    print(json.dumps(flows, indent=2))
    return 0 if flows else 1


def _impact(args: argparse.Namespace) -> int:
    project = _load_project(Path(args.project))
    symbols = [Symbol(**item) for item in project.get("symbols", [])]
    imports = [ImportEdge(**item) for item in project.get("imports", [])]
    calls = [CallEdge(**item) for item in project.get("calls", [])]
    print(json.dumps(impact_slice(args.query, symbols, imports, calls), indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repodna", description="Understand a repository without executing its code.")
    parser.add_argument("--version", action="version", version=f"RepoDNA {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyse = subparsers.add_parser("analyse", aliases=["analyze"], help="Analyse a local or public GitHub repository")
    analyse.add_argument("source", help="Local directory or public GitHub URL")
    analyse.add_argument("-o", "--output", default=".repodna/project.json", help="Portable JSON output path")
    analyse.add_argument("--max-files", type=int, default=10_000)
    analyse.add_argument("--max-file-bytes", type=int, default=1_000_000)
    analyse.set_defaults(handler=_analyse)

    trace = subparsers.add_parser("trace", help="Find execution flows containing a route or symbol")
    trace.add_argument("query")
    trace.add_argument("--project", default=".repodna/project.json")
    trace.set_defaults(handler=_trace)

    impact = subparsers.add_parser("impact", help="Find structural dependents for a symbol")
    impact.add_argument("query")
    impact.add_argument("--project", default=".repodna/project.json")
    impact.set_defaults(handler=_impact)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
