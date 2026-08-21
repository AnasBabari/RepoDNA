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

### Cache

`core/repodna/cache.py` stores per-file analyzer output keyed by SHA-256. A later run reuses the prior structural result when a file hash is unchanged.

### Portable artifact

`AnalysisResult` serializes to schema version `1.0.0`. The artifact contains no source text or secrets. It records paths, structural facts, evidence, diagnostics, and aggregate metadata.

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

