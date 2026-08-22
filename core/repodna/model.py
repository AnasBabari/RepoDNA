from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal


SymbolKind = Literal[
    "module", "class", "function", "method", "interface", "type",
    "constant", "variable", "route", "database_model", "component",
]


@dataclass(slots=True)
class Evidence:
    description: str
    file: str
    line: int | None = None


@dataclass(slots=True)
class FileRecord:
    id: str
    path: str
    language: str
    lines: int
    bytes: int
    hash: str
    role: str = "source"
    parsed: bool = False
    error: str | None = None


@dataclass(slots=True)
class Symbol:
    id: str
    type: SymbolKind
    name: str
    file: str
    line: int
    end_line: int | None = None
    parent: str | None = None
    exported: bool = False
    evidence: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ImportEdge:
    id: str
    source: str
    module: str
    names: list[str]
    line: int
    target: str | None = None
    external: bool = False


@dataclass(slots=True)
class CallEdge:
    id: str
    source: str
    callee: str
    file: str
    line: int
    target: str | None = None
    confidence: float = 0.55


@dataclass(slots=True)
class Route:
    id: str
    method: str
    path: str
    handler: str
    file: str
    line: int
    framework: str
    confidence: float


@dataclass(slots=True)
class Entrypoint:
    id: str
    file: str
    kind: str
    score: int
    confidence: float
    evidence: list[str]


@dataclass(slots=True)
class ArchitectureComponent:
    id: str
    name: str
    type: str
    files: list[str]
    confidence: float
    evidence: list[str]


@dataclass(slots=True)
class ArchitectureConnection:
    id: str
    source: str
    target: str
    type: str
    weight: int


@dataclass(slots=True)
class Diagnostic:
    severity: Literal["info", "warning"]
    code: str
    message: str
    file: str | None = None


@dataclass(slots=True)
class PartialAnalysis:
    file: FileRecord
    symbols: list[Symbol] = field(default_factory=list)
    imports: list[ImportEdge] = field(default_factory=list)
    calls: list[CallEdge] = field(default_factory=list)
    routes: list[Route] = field(default_factory=list)
    frameworks: set[str] = field(default_factory=set)
    databases: set[str] = field(default_factory=set)
    externals: set[str] = field(default_factory=set)
    entrypoint_evidence: list[str] = field(default_factory=list)


@dataclass(slots=True)
class AnalysisResult:
    repository: dict[str, Any]
    technologies: list[str]
    files: list[FileRecord]
    symbols: list[Symbol]
    imports: list[ImportEdge]
    calls: list[CallEdge]
    routes: list[Route]
    databases: list[dict[str, Any]]
    external_systems: list[dict[str, Any]]
    entrypoints: list[Entrypoint]
    flows: list[dict[str, Any]]
    architecture: dict[str, Any]
    important_files: list[dict[str, Any]]
    onboarding: list[dict[str, Any]]
    metrics: dict[str, Any]
    diagnostics: list[Diagnostic]
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["schemaVersion"] = "1.1.0"
        payload["generatedAt"] = datetime.now(UTC).isoformat()
        
        # Canonical camelCase normalization
        payload["externalSystems"] = payload.get("external_systems", [])
        payload["importantFiles"] = payload.get("important_files", [])
        
        # Symbol endLine normalization
        for sym in payload.get("symbols", []):
            if isinstance(sym, dict) and "end_line" in sym and "endLine" not in sym:
                sym["endLine"] = sym["end_line"]
                
        return payload

    def write_json(self, target: Path) -> None:
        import json

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(self.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

