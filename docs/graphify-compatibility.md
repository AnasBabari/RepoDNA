# Graphify compatibility and export contract

Status: implementation reference, 2026-08-27

This document records what RepoDNA exports today, what Graphify v8 exports, and
what an interoperability layer would have to preserve. It is deliberately
explicit: similar-looking graph files are not treated as wire-compatible.

## Executive conclusion

Graphify v8 can export JSON, SVG, GraphML, an Obsidian vault, HTML, and Neo4j
Cypher. Its export functions are deterministic code generation; an AI API key is
not required to produce JSON, GraphML, or Cypher. Graphify may use semantic or
LLM-assisted processing elsewhere in its pipeline, but that is separate from
serializing an already-built graph.

RepoDNA's canonical export is `GraphExportDocumentV1`. It is intentionally
relational and evidence-oriented: nodes, relationships, groups,
group-memberships, unresolved records, and a manifest are exported together.
RepoDNA JSON, CSV, Cypher, Parquet, and Architecture TXT therefore describe the
same normalized graph and do not depend on an LLM.

Primary Graphify references:

- https://github.com/Graphify-Labs/graphify/blob/v8/graphify/export.py
- https://github.com/Graphify-Labs/graphify/blob/v8/ARCHITECTURE.md
- https://github.com/Graphify-Labs/graphify/blob/v8/graphify/skills/vscode/references/exports.md

## Format comparison

| Capability | Graphify v8 | RepoDNA | Compatibility decision |
|---|---|---|---|
| JSON | NetworkX node-link data with `nodes` and `links`, plus Graphify attributes such as communities, normalized labels, confidence, and commit metadata | Versioned `GraphExportDocumentV1` with `manifest`, `nodes`, `relationships`, `groups`, `group_memberships`, and `unresolved` | Not wire-compatible; use an explicit adapter |
| CSV | No first-class CSV exporter was found in the v8 exporter and export reference inspected | Deterministic ZIP containing relational CSV tables and `manifest.json` | RepoDNA CSV is the portable tabular contract |
| Cypher | Code-generated Neo4j statements using escaped values, allowlisted identifiers, `MERGE`, and relationship creation | Code-generated deterministic Cypher using RepoDNA entity/group/unresolved labels and evidence properties | Same safety principle; labels and properties require mapping |
| GraphML | Supported by Graphify | Not currently a RepoDNA export target | Future adapter/export only if a consumer requires it |
| Parquet | No Parquet exporter was found in the v8 sources inspected | Deterministic multi-table Snappy Parquet bundle | RepoDNA-specific; retain schema metadata |
| SVG / HTML | Supported visual exports | The web application is the interactive viewer; Mermaid and Architecture TXT are available | Different presentation layers, not interchangeable graph data |
| Obsidian / wiki | Graphify can write an Obsidian vault and wiki-style artifacts | No Obsidian vault exporter currently | Future presentation adapter |
| Evidence and explanation | Graphify stores graph attributes and confidence information; exact evidence semantics depend on its pipeline | Explicit `evidence`, `status`, `confidence`, `resolver`, explanations, and unresolved expressions | Never infer RepoDNA evidence from a Graphify label alone |

## Canonical field mapping for a future adapter

An adapter must preserve the original Graphify payload instead of silently
discarding fields:

1. Graphify node identifier → RepoDNA `nodes[].id` after deterministic ID
   normalization; preserve the original in `properties.graphify.id`.
2. Graphify node label/file type → the closest RepoDNA node kind. If there is
   no defensible match, use a neutral node kind and preserve the source label.
3. Graphify community → a RepoDNA `groups[]` record plus one
   `group_memberships[]` record per member.
4. Graphify `links[]` → RepoDNA `relationships[]`, preserving source, target,
   relation type, confidence, and all original attributes under
   `properties.graphify`.
5. A link whose source or target cannot be resolved → an `unresolved[]` record;
   do not manufacture a complete-looking edge.
6. Graphify commit metadata → the RepoDNA manifest/source provenance fields.
7. Any field that cannot be mapped semantically → preserve it losslessly in
   namespaced properties and record the mapping decision in the manifest.

The adapter must sort IDs, records, properties, and output rows before writing,
include a source digest, and be idempotent. It must also distinguish a missing
relationship from an intentionally unresolved relationship.

## Cypher without AI

Yes. Cypher can be generated without an AI API key. The exporter should be a
pure function over the normalized graph:

- validate and allowlist labels, relationship types, and property keys;
- escape string, numeric, boolean, null, and list values with a tested encoder;
- emit deterministic `MERGE` statements for nodes;
- emit `MATCH` plus `MERGE` for relationships;
- use stable IDs and include an optional source/analysis namespace to prevent
  collisions between repositories;
- write a manifest comment containing schema version and source digest;
- never interpolate arbitrary source text into identifiers;
- never ask an LLM to invent missing nodes or relationships.

An LLM could optionally enrich explanations later, but that must be a separate,
explicit enrichment stage. Base exports must remain reproducible, offline-capable,
cost-free, and identical for identical graph input.

## Required implementation boundary

Do not add a Graphify importer until a versioned Graphify JSON fixture is checked
in. When the feature is approved, implement it as a separate script or library
with:

- input schema validation and a clear Graphify version;
- fixture-based tests for nodes, links, communities, missing endpoints, duplicate
  IDs, unusual labels, Unicode, and malicious strings;
- golden output tests for RepoDNA JSON, CSV, Cypher, and Parquet;
- a report listing mapped, preserved, and unresolved fields;
- no changes to the existing RepoDNA canonical contract.

## Remaining export work

The current production path is complete for RepoDNA JSON, CSV, Cypher, Parquet,
and Architecture TXT. Remaining optional work is presentation/interoperability,
not a prerequisite for safe exports:

- add GraphML only when a concrete consumer requires it;
- add an Obsidian vault exporter only after defining note/link naming and
  collision rules;
- add a Graphify import adapter only with a pinned fixture and mapping tests;
- expose an export compatibility/version report in the UI if users need to know
  which downstream tools can consume a bundle.

## Verification checklist

- identical analysis input produces byte-stable JSON/CSV/Cypher/Parquet/TXT;
- every exported relationship references an exported node, or is represented in
  `unresolved`;
- unresolved dynamic imports and runtime route mounts remain visibly unresolved;
- Cypher imports twice without duplicate nodes or relationships;
- exports work for ordinary, large, truncated, partially parsed, and empty
  repositories;
- no export path reads an AI key, invokes a model, executes repository code, or
  stores private source outside the configured transient/cache policy.
