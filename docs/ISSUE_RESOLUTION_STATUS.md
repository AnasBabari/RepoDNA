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
   [PR #24](https://github.com/AnasBabari/RepoDNA/pull/24) is unmerged;
   hosted CI run 39048581092 passed all jobs for commit 0b3a195.
4. `codex/unresolved-relationships` → `codex/graph-scope`: inspectable retained
   resolution-gap records, null-target filtering and actual canvas counts (#6).
   [PR #25](https://github.com/AnasBabari/RepoDNA/pull/25) is unmerged;
   hosted CI run 39049499842 passed all jobs for commit 7b0c683.
5. `codex/inventory-evidence` → `codex/unresolved-relationships`: manifest-backed
   declarations, supported-source coverage, unavailable legacy counts, bounded
   provenance and a browser grammar-loader fix found during real upload tests.
   [PR #28](https://github.com/AnasBabari/RepoDNA/pull/28) is draft and unmerged;
   hosted CI run 39053444088 passed all jobs for commit 7b652e5. Its exact
   Vercel preview is READY; interactive acceptance still requires Vercel login.
6. `codex/evidence-based-roles` → `codex/inventory-evidence`: primary language
   ranked by recorded evidence, syntax-backed components, neutral Python src/app
   roles and explicitly heuristic confidence. This batch addresses #8.
   [PR #29](https://github.com/AnasBabari/RepoDNA/pull/29) is draft and unmerged;
   hosted CI run 39073700085 passed all jobs at c08616b. Exact-commit preview
   is READY; protected interactive acceptance remains unverified.
7. `codex/file-ranking-evidence` → `codex/evidence-based-roles`: unique full-path
   file summaries, merged per-symbol evidence and honest recorded-score scope (#26).
   PR #30 remains draft and unmerged; hosted CI run 39074742394 passed all jobs.
8. `codex/github-ref-identity` → `codex/file-ranking-evidence`: immutable revision
   identity across durable, legacy-server, browser-worker and private paths (#9).
   Shared URL resolution rejects ambiguity rather than substituting HEAD.
   [PR #31](https://github.com/AnasBabari/RepoDNA/pull/31) is draft and unmerged.

## Issue-by-issue state

| Issue | Implementation / remaining acceptance |
| --- | --- |
| #1 | Production dependency patches in PR #22; production audit clean, hosted CI passed. Full interactive preview/release verification pending. |
| #2 | Cypher comment metadata inert in PR #22; adversarial fixtures and real Neo4j double import verified. |
| #3 | Implemented in PR #23: all five Tree-sitter languages, extraction/AST bounds and schema/UI/TXT/export provenance. Local and hosted CI passed; unmerged review/interactive preview acceptance remain. |
| #4 | Implemented in analysis-truthfulness: conservative shared quality; nanoGPT's 444 unresolved relationships and compacted/bounded fixtures have browser regressions. |
| #5 | Implemented in PR #24: original/retained/omitted scope and bounded-export disclosure. Hosted CI passed; review and interactive preview acceptance remain. |
| #6 | Implemented in PR #25: searchable retained gaps, null targets, relevant-only nodes and drawable-edge counts. 368 unit / 31 Python and both local browser variants passed; hosted CI passed. Unmerged. |
| #7 | Implemented on inventory-evidence: manifest roots/scopes, supported-source denominator, reconciled outcomes, schema/UI/TXT/all export evidence and nullable legacy counts. Local verification below; unmerged review remains. |
| #8 | Implemented on evidence-based-roles: quantitative language ranking, syntax-backed UI roles and neutral Python src/app files. Local verification below; unmerged review remains. |
| #9 | Implemented in PR #31: bounded tag/branch/commit resolution, pinned acquisition, portable identity and actionable failures. 466 unit / 34 Python tests, both builds/typechecks and 64 production-mode browser tests pass; hosted CI confirmation and protected interactive acceptance remain separate. Unmerged review remains. |
| #10 | Implemented on sample-freshness: explicit allowlisted snapshot actions/query, visible date/commit, Analyze latest, and no sample substitution for normal URL input. Nine focused browser tests/typecheck pass; unmerged review remains. |
| #11 | Implemented on repository-pagination: upstream OAuth pages are not sliced twice, App results remain installation-scoped, OAuth first-100 search is explicitly disclosed, truncated listings cannot create endless Next pages, and stale requests are cancelled. Seven API tests and picker browser test pass; unmerged review remains. |
| #12 | Implemented in PR #34: snapshot-scoped IDs, original IDs, lossless manifest and membershipReason. Real Neo4j 5 verified two repositories/two commits imported twice without collisions; container removed. Unmerged review remains. |
| #13 | Implemented on graph-keyboard: Enter/Space share pointer inspection/expansion, contextual labels, detail focus and restoration on close/Escape. Two browser regressions and typecheck pass; unmerged. |
| #14 | Pending: non-export modal focus, semantics and restoration. |
| #15 | Responsive controls verified at 320–1440px in PR #22; long names and actual 200% browser zoom still need acceptance tests. |
| #16 | Pending: feedback delivery must not acknowledge a dropped submission. |
| #17 | Scan-counter abort/single-flight lifecycle implemented in PR #22; unit/browser and hosted smoke pass. |
| #18 | Capability/privacy copy corrected in PR #22. |
| #19 | Browser-copy drift regressions included in PR #22. |
| #20 | Type generation fix implemented in PR #22; clean hosted CI verifies serial mixed Next/Vinext build orders. |
| #21 | Pending: development-tool advisories need compatible patches or an explicit time-bounded, reproducible mitigation. Production audit success does not resolve this issue. |
| #26 | Implemented on file-ranking-evidence: unique full-path rankings, merged symbol reasons and explicit score scope. Canonical node data stays unchanged; local verification below and unmerged review remain. |
| #27 | Implemented on inventory-evidence: browser grammar bytes avoid unsafe Node detection; rejected parser promises retry. Real uploads parse Python/JS/TS/TSX/Go; unmerged review remains. |

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

## Inventory-evidence verification checkpoint

- 391 unit tests and 31 Python tests pass; production dependency audit has zero
  findings. The 11 development-tool findings (8 high, 3 moderate) remain #21.
- Lint has zero errors and the same two existing authentication-navigation
  warnings; no lint rule or CSP policy was relaxed.
- Vinext build → typecheck → Next production build → typecheck passed, with
  no deletion of generated outputs. New caches use analyzer 2.0.4 / exporter
  1.0.4; see `docs/inventory-evidence.md` for count and bound definitions.
- Full local Next production browser suite: 52 passed / one expected skip
  with Parquet disabled. Separate enabled-Parquet export/inventory suite:
  11 passed / one expected skip, including actual Parquet downloads. Both flags
  were process-local; these are local production builds, not live Vercel.
- A real Requests-like ZIP verifies 37 complete source files despite eight
  Makefiles, four declared dependencies, provenance in UI/JSON/TXT and current
  source accounting. Real uploaded Python/JS/TS/TSX/Go fixtures all parse.
- JSON, CSV, Parquet and Cypher's base64 manifest retain identical inventory
  evidence in serializer regressions. Legacy unknown totals are null, not zero.
- Protected interactive Vercel preview acceptance remains separate: local
  development OIDC is expired. No token was printed, env file overwritten,
  deployment protection disabled, production deployment promoted or PR merged.

## Evidence-based roles verification checkpoint

- 412 unit tests and 34 Python tests pass; both builds and subsequent typechecks
  pass. Lint has zero errors and the same two authentication-navigation warnings.
- The targeted Vinext browser run passed all eight tests, including real ZIP
  uploads: Python src/app files remain unclassified; observed React/Next JSX
  retains frontend evidence; canonical language proportions remain unchanged.
- Full local Next production browser confirmation: 55 passed / one expected
  feature-off skip with Parquet enabled, including real downloads in all formats.
- Confidence is documented as a rule-based heuristic, not a probability or an
  architecture-match score. See `docs/role-evidence.md` for exact fallback rules.
- Cache namespaces are analyzer 2.0.5 / exporter 1.0.5; old artifacts retain
  their own TTL and evidence. No cache schema, retention or privacy change.
- These are local results, not a production release. All PRs remain unmerged.

## File-ranking evidence verification checkpoint

- 416 unit tests and 34 Python tests pass. Lint has zero errors and the same
  two authentication-navigation warnings; production dependency audit is clean.
- Vinext build → typecheck → Next production build → typecheck pass without
  deleting generated outputs or changing environment files.
- Five focused Vinext browser tests pass on frozen sources: normalized rows,
  original nanoGPT duplicate-key regression, canonical JSON preservation and
  the preceding Python/React role flows. An invalid new fixture was corrected
  to include its referenced file; production guards were not weakened.
- Full local Next production browser suite: 57 passed / one expected feature-off
  skip with Parquet enabled. JSON, CSV, Cypher, Parquet and TXT downloads passed;
  the new 390px long-symbol evidence check has no ranking-panel overflow.
- `docs/file-rankings.md` defines distinct-node score sums, merged evidence,
  path identity and pre-capped ranking scope. The TXT report no longer calls
  node-link incidences unique dependents. Canonical JSON/graph facts are unchanged;
  this projection-only fix needs no cache migration.
- No merge or production deployment. Remaining audit issues above are not
  resolved by these checks; protected interactive preview acceptance is separate.
  A fresh Chrome check still redirects to Vercel login, and the browser connector
  subsequently requests an extension update. No authentication or protection was changed.

## GitHub revision verification checkpoint (18 October 2026)

- 466 unit tests and 34 Python tests pass; production dependency audit has zero
  findings. Lint has zero errors and the same two authentication-navigation warnings.
- Vinext build → typecheck → Next production build → typecheck pass without
  deleting generated outputs or overwriting environment files.
- Five targeted Vinext browser tests passed. Final local Next production browser
  suite: 64 passed / one expected feature-off skip with Parquet enabled; zero
  failures/flaky cases. The saved JSON report records all 65 cases. Actual worker
  scans of a tag, encoded-slash branch and commit URL retain identity in UI/JSON;
  ambiguity, missing and unsupported ref errors stop without substituting HEAD.
- JSON, CSV, Cypher, readable Parquet and TXT downloads pass. Unit regressions
  verify manifest identity across these formats and v1 adaptation, archive/tree
  parity, private credential isolation and public-cache identity rejection.
- Hosted run 39123645945 exposed a pre-existing live GitHub call in a golden
  unit test: the shared runner IP received HTTP 429. The test now extracts and
  analyzes a real ZIP of checked-in mixed-language fixtures; all original safety/
  architecture assertions remain, with additional exact-count/SHA checks. No
  skip, credential injection or rate-limit relaxation was added. Replacement
  hosted CI must be checked before claiming hosted success.
- See `docs/github-revisions.md` for immutable SHA identity, whole-repository URL
  scope, conservative ambiguity handling and non-destructive cache namespaces.
  Vercel preview readiness is not interactive acceptance or a production release.
  No PR was merged and no production deployment was promoted.
