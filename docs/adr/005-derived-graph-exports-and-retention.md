# ADR 005: Derived graph exports and retention

- Status: Accepted
- Date: 2026-08-27
- Scope: graph downloads, export caching, and downstream graph interoperability

## Context

RepoDNA's canvas is useful for exploration, but a canvas is not a durable interface for scripts, data tools, or graph databases. Users need to export relationships, groupings, properties, evidence, explanations, and resolution gaps. The output must be repeatable, safe to import, and affordable to operate on Vercel Hobby without an always-on database or an AI API key.

The analyzer also has partial-resolution cases. Hiding those cases behind a complete-looking diagram would make exports misleading, especially for dynamic Express mounts, generated routes, aliases, and repositories that exceed analysis guardrails.

## Decision

1. Maintain one canonical `GraphExportDocumentV1` IR containing nodes, relationships, groups, group memberships, unresolved entries, and a manifest with coverage/completeness.
2. Serialize that IR deterministically into JSON, a five-table CSV ZIP, Neo4j 5+ Cypher, and—behind an explicit feature flag—a five-table Parquet ZIP. The feature flag is enabled for the Vercel Production deployment after live verification.
3. Encode arrays and arbitrary properties as stable JSON strings in CSV/Parquet. Preserve nulls, `why`, evidence ranges, resolver metadata, confidence, and unresolved expressions.
4. Generate Cypher in code with allowlists, literal escaping, `UNWIND` batches, uniqueness constraints, and `MERGE`. Do not use an LLM or AI API for export generation.
5. Cache only derived artifacts/exports:
   - private Vercel Blob for public, commit-addressed durable cache entries;
   - opt-in IndexedDB for browser-local artifacts and export blobs;
   - seven-day TTL, signed five-minute download URLs, and explicit cleanup/eviction rules.
6. Generate exports in a browser worker. If the server cache or server serializer is unavailable, use a clearly reported browser fallback.
7. Export the full canonical graph regardless of the current visual filter or layout. Record partial coverage and unresolved links instead of inventing completeness.

## Alternatives considered

### Neo4j as the primary storage layer

Rejected for V1. It would add a paid/operational dependency and require a database lifecycle for a derived, commit-addressed artifact. The generated Cypher file gives users an explicit import path while Vercel Blob and IndexedDB handle cache needs.

### An LLM-generated Cypher script

Rejected. It raises cost, latency, privacy, reproducibility, and injection concerns. All graph fields are already structured, so a deterministic serializer can create safe Cypher directly.

### One wide CSV or one wide Parquet table

Rejected. Nodes, links, groups, memberships, and unresolved records have different cardinalities and would require duplicated data or lossy nested columns. Five relational tables preserve the graph shape and are straightforward to join in DuckDB, pandas, or SQL.

### Public object URLs

Rejected. Analysis artifacts and derived exports can contain private repository metadata. Blob objects remain private and are accessed through short-lived, read-only signed URLs.

## Consequences

Positive:

- identical source artifacts produce identical export bytes and hashes;
- downstream users can choose a document, tabular, or graph-database representation;
- unresolved analysis is inspectable and machine-readable;
- no AI API key, graph database, or always-on service is required;
- cache keys are tied to commit and source digest, preventing stale cross-repository results.

Trade-offs:

- arbitrary properties remain JSON strings in CSV/Parquet rather than fully typed nested columns;
- Parquet adds a dependency and remains independently switchable per deployment environment;
- private browser caching is explicitly opt-in and bounded by browser quota;
- the analyzer's completeness limits still apply and are surfaced rather than hidden.

## Verification

- Unit tests validate stable bytes, schema parity, CSV formula protection, Parquet metadata/round-trip reads, cache TTL/LRU behavior, API validation, and worker fallback.
- Playwright verifies the Export dialog, keyboard behavior, JSON/CSV/Cypher downloads, canonical export under a visual filter, server fallback, and the Parquet feature gate; live smoke tests verify all four formats against public repositories.
- `tests/integration/run-neo4j-double-import.mjs` runs the generated Cypher against Neo4j 5 Community twice and verifies idempotency, counts, constraints, and injection safety.
