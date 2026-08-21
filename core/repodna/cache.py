from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from repodna.model import CallEdge, FileRecord, ImportEdge, PartialAnalysis, Route, Symbol


CACHE_VERSION = 1


class AnalysisCache:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        self.entries: dict[str, dict] = {}
        self.hits = 0
        self.misses = 0
        if path and path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                if payload.get("version") == CACHE_VERSION and isinstance(payload.get("entries"), dict):
                    self.entries = payload["entries"]
            except (OSError, json.JSONDecodeError, TypeError):
                self.entries = {}

    def restore(self, file: FileRecord) -> PartialAnalysis | None:
        entry = self.entries.get(file.path)
        if not entry or entry.get("hash") != file.hash:
            self.misses += 1
            return None
        try:
            file.parsed = bool(entry.get("parsed"))
            file.error = entry.get("error")
            partial = PartialAnalysis(
                file=file,
                symbols=[Symbol(**item) for item in entry.get("symbols", [])],
                imports=[ImportEdge(**item) for item in entry.get("imports", [])],
                calls=[CallEdge(**item) for item in entry.get("calls", [])],
                routes=[Route(**item) for item in entry.get("routes", [])],
                frameworks=set(entry.get("frameworks", [])),
                databases=set(entry.get("databases", [])),
                externals=set(entry.get("externals", [])),
                entrypoint_evidence=list(entry.get("entrypointEvidence", [])),
            )
        except (TypeError, ValueError):
            self.misses += 1
            return None
        self.hits += 1
        return partial

    def store(self, partials: list[PartialAnalysis]) -> None:
        if not self.path:
            return
        entries: dict[str, dict] = {}
        for partial in partials:
            entries[partial.file.path] = {
                "hash": partial.file.hash,
                "parsed": partial.file.parsed,
                "error": partial.file.error,
                "symbols": [asdict(item) for item in partial.symbols],
                "imports": [asdict(item) for item in partial.imports],
                "calls": [asdict(item) for item in partial.calls],
                "routes": [asdict(item) for item in partial.routes],
                "frameworks": sorted(partial.frameworks),
                "databases": sorted(partial.databases),
                "externals": sorted(partial.externals),
                "entrypointEvidence": partial.entrypoint_evidence,
            }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"version": CACHE_VERSION, "entries": entries}, indent=2) + "\n",
            encoding="utf-8",
        )

