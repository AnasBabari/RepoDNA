# Audit remediation — unmerged review work

The audit issues remain open for review. No pull request may be merged or
production deployment promoted without the maintainer's direction. A completed
local test is not evidence that production contains a fix.

## Review order

1. [PR #22](https://github.com/AnasBabari/RepoDNA/pull/22),
   `codex/launch-hardening-review` → `main`: dependency/build hardening,
   Cypher header safety, scan-counter lifecycle, and the selected dark UI.
   Hosted [CI run 38975493454](https://github.com/AnasBabari/RepoDNA/actions/runs/38975493454)
   passed engine, visualizer, cross-engine parity and browser smoke jobs.
   The exact-commit Vercel preview is READY and authenticated SSR was checked.
   Full interactive preview E2E is **not verified**: unauthenticated browser
   requests redirect to Vercel login. Protection was not disabled.
2. `codex/analysis-truthfulness` → `codex/launch-hardening-review`:
   extraction-limit provenance, shared completeness interpretation and cache
   versioning. This is a stacked review batch, not an independent main release.
   [PR #23](https://github.com/AnasBabari/RepoDNA/pull/23) is unmerged;
   hosted CI run 38977698261 passed all jobs for commit 4b61731.
3. `codex/graph-scope` → `codex/analysis-truthfulness`: original/retained/omitted
   counts, explicit export/analytics scope and unknown legacy totals (#5).
   [PR #24](https://github.com/AnasBabari/RepoDNA/pull/24) is unmerged; 47 local
   browser tests passed / one expected skip. Hosted build jobs passed; browser
   smoke remains a separate running gate at the checkpoint.
4. `codex/unresolved-relationships` → `codex/graph-scope`: inspectable retained
   resolution-gap records, null-target filtering and actual canvas counts (#6).

## Issue-by-issue state

| Issue | Implementation / remaining acceptance |
| --- | --- |
| #1 | Production dependency patches in PR #22; production audit clean, hosted CI passed. Full interactive preview/release verification pending. |
| #2 | Cypher comment metadata inert in PR #22; adversarial fixtures and real Neo4j double import verified. |
| #3 | Implemented in analysis-truthfulness: all five Tree-sitter languages, exact/lower-bound omitted counts, AST budgets, schema/UI/TXT/all export provenance. Local verification passed; review/hosted checks pending. |
| #4 | Implemented in analysis-truthfulness: conservative shared quality; nanoGPT's 444 unresolved relationships and compacted/bounded fixtures have browser regressions. |
| #5 | Implemented in graph-scope: pre-compaction/global counts, bounded-export scope and retained-subgraph analytics disclosure. Unit and targeted browser checks pass; full review checks pending. |
| #6 | Implemented in unresolved-relationships: searchable/paginated evidence including orphan records, source inspector links, relevant-only nodes and actual rendered-edge counts. 368 unit tests and targeted browser/type checks pass; full review gates pending. |
| #7 | Pending: source coverage/package/dependency inventory semantics. Partial/failed per-file deduplication is improved in #3, not the whole issue. |
| #8 | Pending: Python src-layout architecture roles and primary-language selection. |
| #9 | Pending: honor explicit tree/blob refs during GitHub analysis. |
| #10 | Partially addressed by visible bundled-snapshot provenance; sample short-circuit/reanalyze behavior still pending. |
| #11 | Pending: GitHub repository pagination and search beyond first page. |
| #12 | Pending: Neo4j multi-snapshot isolation/membership provenance. Existing same-snapshot idempotency is not sufficient. |
| #13 | Pending: graph keyboard activation. |
| #14 | Pending: non-export modal focus, semantics and restoration. |
| #15 | Responsive controls verified at 320–1440px in PR #22; long names and actual 200% browser zoom still need acceptance tests. |
| #16 | Pending: feedback delivery must not acknowledge a dropped submission. |
| #17 | Scan-counter abort/single-flight lifecycle implemented in PR #22; unit/browser and hosted smoke pass. |
| #18 | Capability/privacy copy corrected in PR #22. |
| #19 | Browser-copy drift regressions included in PR #22. |
| #20 | Type generation fix implemented in PR #22; clean hosted CI verifies serial mixed Next/Vinext build orders. |
| #21 | Pending: development-tool advisories need compatible patches or an explicit time-bounded, reproducible mitigation. Production audit success does not resolve this issue. |

## Analysis-truthfulness verification checkpoint

- 355 unit tests and 31 Python tests pass.
- Local browser suite: 45 passed, one expected skip (Parquet feature flag off).
- Parser tests include below/at/above symbol, import and call caps for all five
  languages, plus AST node/depth budgets; a valid 1,005-function Python file
  retains 1,000 facts and reports the five omissions as bounded extraction.
- JSON, CSV, Parquet, Cypher's base64 UTF-8 manifest, and TXT agree on extraction
  provenance. Optional additive schema fields are validated under both Ajv and
  the CSP-safe fallback.
- Lint has zero errors and the two existing authentication-navigation warnings;
  no rule was disabled and authentication redirect semantics were not changed.
- Next production build → typecheck → Vinext build → typecheck passed without
  deleting generated outputs. Existing upstream Vinext/tree-sitter build warnings
  remain; do not infer deployment acceptance or production repair from this
  local checkpoint.

Cache migration is non-destructive: analyzer 2.0.1 / exporter 1.0.1 use new keys;
older artifacts/exports retain their original TTL and are not returned by new
lookups. Cache schema, retention, consent and private-data policy are unchanged.

## Incremental-commit policy

From 17 October 2026, each new commit must change fewer than 100 total lines
(additions + deletions, including tests/docs). Measure the staged diff before
committing. Existing pushed history is preserved. This is a review-size rule,
not a reason to omit acceptance tests or narrow any audit issue.

The #6 cache namespace is analyzer 2.0.3 / exporter 1.0.3: dangling endpoints
are conservatively counted as gaps even if an older artifact flags them resolved.
