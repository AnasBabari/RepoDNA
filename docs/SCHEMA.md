# `repodna.json` schema

The portable artifact is the contract between the analyzer, CLI, visualizer, and future integrations. V1 emits `schemaVersion: "1.0.0"`.

## Top-level fields

| Field | Purpose |
| --- | --- |
| `repository` | Name, source, language distribution, counts, and manifest fingerprint |
| `technologies` | Normalized technology names detected from evidence |
| `files` | Indexed files with language, size, line count, content hash, and parse status |
| `symbols` | Modules, classes, functions, methods, interfaces, types, components, and ORM models |
| `imports` | File-to-module imports plus resolved local targets |
| `calls` | Symbol calls plus high-confidence resolved targets |
| `routes` | HTTP method, path, handler, framework, location, and confidence |
| `databases` | Database boundaries with supporting evidence |
| `external_systems` | External service boundaries with supporting evidence |
| `entrypoints` | Ranked execution starts with evidence and confidence |
| `flows` | Route-to-symbol execution traces |
| `architecture` | Conceptual components and weighted connections |
| `important_files` | Ranked reading candidates and score reasons |
| `onboarding` | Deterministic repository tour |
| `metrics` | Complexity, dependencies, cycles, centrality, counts, and parse success |
| `diagnostics` | Skipped or malformed file information |
| `metadata` | Analysis mode, safety invariant, limits, component lookup, and cache results |

## Stable IDs

File IDs use the normalized repository-relative path:

```text
file:services/user.py
```

Symbol IDs include parents:

```text
services/user.py::UserService::create_user
```

Route and edge IDs include their source location and structural identity. Consumers should use IDs for selection and traversal, and human-readable names only for display.

## Compatibility

Consumers must reject artifacts without a supported `schemaVersion`. Additive fields may appear within the same major version. A breaking field or ID change requires a new major schema version.

## Privacy

The artifact does not contain source bodies, environment values, credentials, Git history, author identity, or repository secrets. Evidence references paths and line numbers only.

