# RepoDNA graph exports

RepoDNA has one canonical, provider-neutral graph document and several deterministic serializers. A download is a portable snapshot of the analysis rather than a screenshot of the current canvas.

## User workflow

1. Analyze a repository and open **Relationship explorer → Code Graph**.
2. Select **Export**.
3. Choose JSON, CSV tables, Neo4j Cypher, or Parquet when the Parquet feature flag is enabled.
4. The export is generated in a worker when the browser supports workers. A cached browser copy or a private Vercel Blob copy is reused when available.
5. The dialog reports whether the result was generated or served from cache and downloads the verified bytes.

The export is independent of the graph's visual filter, layout, zoom, and viewport. Choosing **Unresolved only**, a layer filter, or a selected node changes presentation only; it never silently removes canonical nodes or relationships from a download. Coverage and completeness are recorded in `manifest.json`, and unresolved links are retained as rows.

## Formats

| Format | Download | Intended consumer | Status |
| --- | --- | --- | --- |
| Graph JSON | `*-repodna-graph.json` | RepoDNA, scripts, long-term snapshots | Enabled |
| CSV tables | `*-repodna-csv.zip` | Excel, DuckDB, pandas, SQL import | Enabled |
| Neo4j Cypher | `*-repodna-cypher.txt` | Neo4j 5+ | Enabled |
| Parquet tables | `*-repodna-parquet.zip` | DuckDB, PyArrow, data-lake tools | Implemented behind `NEXT_PUBLIC_REPODNA_PARQUET_EXPORT`; disabled by default until production verification |

Every format contains the same logical graph. Serializers use stable ID ordering, the export schema version, the source artifact SHA-256, and deterministic metadata. ZIP members use a fixed timestamp so repeated exports of the same artifact are byte-identical.

## Canonical graph contents

The graph document contains these lists:

- `nodes`: entities such as files, modules, classes, functions, routes, services, components, models, databases, dependencies, and configuration. Each node includes `id`, kind, display and qualified names, path, language, source range, confidence, evidence, normalized properties, and community/architecture group IDs.
- `relationships`: links between entities. Each row includes source and target IDs (or a null target for unresolved/ambiguous links), relationship type and status, confidence, `why`, evidence file/range, resolver name/version, alternative candidates, unresolved expression, and normalized properties.
- `groups`: community and architecture group definitions, including label, cohesion, confidence, evidence, and properties.
- `groupMemberships`: the many-to-many node/group join table, with a reason of `community-detection` or `architecture-file-membership`.
- `unresolved`: first-class resolution gaps keyed to an edge ID. These rows preserve the source, attempted relationship type, reason, expression, candidate IDs, and evidence location.

`why`, `evidence`, and `properties` are derived by deterministic analyzers. No LLM call is needed to create an export or a Cypher file.

## JSON

Graph JSON is the complete `GraphExportDocumentV1` object. It is validated against [`schema/repodna-graph-export-v1.schema.json`](../schema/repodna-graph-export-v1.schema.json), formatted with stable key ordering, and contains all five lists above plus the manifest.

## CSV

CSV is a ZIP with exactly these members:

```text
manifest.json
nodes.csv
relationships.csv
groups.csv
group_memberships.csv
unresolved.csv
```

`manifest.json` repeats the canonical manifest and includes each member's byte size and SHA-256. JSON-valued arrays and objects are stored as compact, stable JSON in columns ending in `_json`. Null values are empty cells. CSV cells beginning (after whitespace) with `=`, `+`, `-`, `@`, tab, or carriage return receive an apostrophe prefix to prevent spreadsheet formula execution; the original value remains visible as text.

## Neo4j Cypher

The Cypher serializer is a source-code serializer, not an AI-generated script. It uses an allowlist for node labels and relationship types, escapes all string literals, stores complex values as JSON strings, and uses `UNWIND` batches of 500 rows.

The output:

- creates three idempotent uniqueness constraints for `RepoDNAEntity`, `RepoDNAGroup`, and `RepoDNAUnresolved`;
- uses `MERGE` for entities, groups, unresolved placeholders, and links;
- stores `why`, evidence, resolver metadata, alternatives, unresolved expressions, and properties on relationships;
- represents unresolved link targets as `RepoDNAUnresolved` nodes with `syntheticTarget = true`;
- uses `MEMBER_OF` for group membership;
- does not require APOC, an AI API key, or runtime execution of repository code;
- contains no destructive `DROP`, `DELETE`, or unconstrained `CREATE` statements.

Example import:

```bash
cypher-shell -u neo4j -p <password> --format verbose < repository-repodna-cypher.txt
```

The Docker-backed integration harness imports the same generated file twice into Neo4j 5 Community and verifies that the second import adds no nodes or relationships, all counts equal the manifest, all constraints exist, and hostile values remain data.

## Parquet

Parquet is packaged as a ZIP because the graph is relational rather than one wide row. It contains `manifest.json` and the same five table names with a `.parquet` extension:

```text
manifest.json
nodes.parquet
relationships.parquet
groups.parquet
group_memberships.parquet
unresolved.parquet
```

The writer uses the browser-compatible `hyparquet-writer` package, Snappy compression, 1,000-row groups, stable column order, and optional columns so null targets and nullable confidence/cohesion values remain lossless. Scalar ranges use `INT32`, numeric scores use `DOUBLE`, and arrays/objects use stable JSON strings in `STRING` columns. Each table contains Parquet key/value metadata identifying the RepoDNA export schema, table, and source digest. The ZIP manifest describes table columns, types, nullability, row files, sizes, and hashes.

Parquet is generated only when `NEXT_PUBLIC_REPODNA_PARQUET_EXPORT=true`. Keeping the flag false hides the button and returns `PARQUET_EXPORT_DISABLED` from both the worker pipeline and server endpoint; this prevents advertising an unverified production feature.

## API and cache lifecycle

The server export endpoint is:

```text
POST /api/v2/exports
```

The request body is:

```json
{
  "owner": "owner",
  "repo": "repository",
  "commitSha": "40-character commit SHA",
  "format": "graph-json | csv | cypher | parquet",
  "exportSchemaVersion": "1.0.0"
}
```

The endpoint only exports a previously cached canonical analysis artifact. It never accepts source code in the export request. It validates the repository segment, commit SHA, format, schema version, and artifact schema before serialization.

For public analyses, the durable cache is private Vercel Blob storage. The key includes owner, repository, commit, analyzer version, source digest, export schema, format, and artifact expiry. The analysis/export TTL is seven days. The response includes a five-minute signed, read-only download URL; the Blob object itself is never public. A metadata sidecar records byte size, media type, and digest. The daily cleanup route removes expired analysis and export objects and reports failed deletions instead of claiming they succeeded.

If the Blob cache is absent, rate-limited, or unavailable, the browser safely generates the export in a worker and downloads it locally. The UI explains that fallback rather than failing silently.

For an explicit browser-cache opt-in, IndexedDB stores normalized analysis artifacts and generated export blobs—not raw repository source. Entries expire after seven days, are limited to ten artifacts, and are evicted least-recently-used when the smaller of 200 MiB or 20% of the browser quota would be exceeded. Private-repository artifacts are not sent to the public Blob cache.

## Large repositories and honest completeness

The archive guardrails still apply before graph export: 25 MiB compressed archive, 100 MiB extracted content, 20,000 archive entries, 10,000 candidate source files, 1 MiB per file, and a 20-second GitHub fetch timeout. These are resource-safety limits, not a claim that every repository has been fully understood.

When analysis is partial, the export preserves the analyzer's `coverage.percentage`, `coverage.truncationReasons`, `completeness.status`, and `completeness.reasons`. A relationship that cannot be resolved is represented in `relationships` and `unresolved` rather than replaced by a visually complete edge. Consumers should use `status`, `confidence`, and the unresolved table when making decisions about architecture.

## Verification commands

```bash
npx vitest run
npx tsc --noEmit -p tsconfig.json --incremental false
npm run lint
npx playwright test --reporter=line
node tests/integration/run-neo4j-double-import.mjs
npm run build
npm run build:vercel
```

The Neo4j command is environment-gated: if Docker is unavailable it reports a skip and exits successfully; when Docker is available it performs the full two-import verification.
