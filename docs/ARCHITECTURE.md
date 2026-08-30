# RepoDNA architecture

## Design principles

1. Repository code is data, never executable input.
2. Every inference carries evidence or a confidence score.
3. Language-specific parsing stays behind a common adapter boundary.
4. The portable JSON artifact is the protocol between analysis and presentation.
5. A malformed file degrades one result; it does not fail the repository.

## Layers

### Repository ingestion

`core/repodna/ingestion.py` handles local paths and public GitHub archives. It applies built-in exclusions and `.gitignore`, rejects binary and oversized files, validates archive paths, and produces a stable sorted file list.

### Fingerprinting

`core/repodna/detection.py` reads manifests and configuration to identify languages, frameworks, databases, infrastructure, testing tools, and external systems before deep parsing completes.

### Language adapters

All analyzers implement `LanguageAnalyzer` from `core/repodna/analyzers/base.py`.

- `PythonAnalyzer` uses Python's AST for imports, classes, functions, methods, calls, framework routes, ORM models, and entry-point evidence.
- `JavaScriptAnalyzer` extracts ES/CommonJS imports, functions, classes, interfaces, types, React components, calls, Express routes, Next.js routes, and entry-point evidence.

An adapter returns `PartialAnalysis`; it does not know about architecture layout or the UI.

### Graph generation

`core/repodna/graph.py` resolves local imports and calls, groups files into conceptual components, calculates component connections and graph metrics, ranks important files and entry points, creates traceable request flows, and builds deterministic onboarding and impact views.

### Cache and retention

The Python engine can reuse per-file analyzer output keyed by SHA-256. Public
web analyses additionally use a private, commit-addressed Vercel Blob artifact
cache with a seven-day TTL. Derived public exports use the same private storage
boundary and short-lived signed download URLs. Browser-local derived artifacts
are retained in IndexedDB only after explicit consent and are quota bounded.
Private source files are processed transiently and are never written to these
server caches.

### Portable artifact

The legacy analyzer emits schema `1.1.0`; the canonical web analyzer emits schema
`2.0.0`. Both artifacts contain structural facts, paths, evidence, diagnostics,
coverage, and aggregate metadata, but no source text or credentials. The v2
artifact is authoritative for graph views and deterministic JSON, CSV, Cypher,
Parquet, and architecture-text exports.

### Visualizer

The React application consumes only the artifact. `RepoWorkspace` owns project import, navigation, search, selection, trace, and impact state. `ArchitectureGraph` turns normalized components and connections into the interactive React Flow map.

## Confidence

RepoDNA avoids presenting heuristics as certainty. Framework routes parsed from syntax receive high confidence. Architecture components inferred from directory and dependency evidence receive lower confidence. The user can inspect the evidence behind each result.

## Extending a language

1. Implement `LanguageAnalyzer`.
2. Return stable symbol and edge IDs.
3. Add focused unit fixtures.
4. Register the adapter in `core/repodna/engine.py`.
5. Extend the quality benchmark before enabling the adapter by default.
