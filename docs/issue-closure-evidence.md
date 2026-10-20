# Audit acceptance evidence — 20 October 2026

The sixteen audit PRs (#22–25 and #28–39) were reviewed and merged through
#22 into main `6f62c74e4004346fa00d633aa10e2e64f789f2dd` on 18 October.
[Post-merge CI](https://github.com/AnasBabari/RepoDNA/actions/runs/39168909756)
passed engine, visualizer, cross-engine parity and browser smoke. Vercel's
public production alias was independently confirmed READY at that exact SHA.
The unmerged/draft statements in ISSUE_RESOLUTION_STATUS.md are historical,
not the current release state. Issue closure comments record final acceptance.

## Requirement-to-regression map

Paths below are repository-relative. Each issue's Done When checklist remains
the authority; this map identifies the concrete checks, not a blanket waiver.

| Issue | Acceptance implementation and evidence |
| --- | --- |
| #1 | `package-lock.json`, production audit CI gate, `docs/dependency-security.md`; clean npm ci in hosted CI, both builders, fresh production analysis/exports. |
| #2 | `tests/unit/export/cypher-header.test.ts`, hostile static fixture and real `tests/integration/run-neo4j-double-import.mjs`: inert metadata, repeated import, no injected nodes. |
| #3 | `parser-extraction-limits.test.ts`, `export/extraction-provenance.test.ts`: all five grammars, exact fact/AST limits and schema/UI/TXT/JSON/CSV/Cypher/Parquet provenance. |
| #4 | `e2e/analysis-quality.spec.ts`: 444 unresolved nanoGPT links plus compacted/extraction-limited artifacts; both overview audiences and TXT agree. |
| #5 | `graph-scope.test.ts`, `export/graph-scope-export.test.ts`, `e2e/graph-scope.spec.ts`: original/retained/omitted and unknown legacy counts, reduced analytics scope. |
| #6 | `e2e/unresolved-relationships.spec.ts`: null-only and mixed gaps, all pages/search/evidence, relevant nodes and exact rendered-edge DOM counts. |
| #7 | `manifest-inventory.test.ts`, `inventory-coverage.test.ts`, `export/inventory-evidence.test.ts`, `e2e/inventory-evidence.spec.ts`: actual manifest declarations, outcome reconciliation and Makefile exclusion. |
| #8 | `architecture-roles.test.ts`, `component-evidence.test.ts`, `e2e/technology-roles.spec.ts`: Python src/app neutrality, primary-language evidence, actual React syntax and heuristic confidence. |
| #9 | `github-ref-*.test.ts`, `github-revision.test.ts`, `export/revision-identity.test.ts`, `e2e/github-revisions.spec.ts`: immutable SHA, tags/slash refs, archive/tree/private parity and actionable ambiguity. |
| #10 | `bundled-samples.test.ts`, `e2e/sample-freshness.spec.ts`: explicit snapshot date/commit, Analyze latest, normal URL freshness, allowlist/cache/counter behavior. |
| #11 | `repository-pagination.test.ts`, `e2e/repository-pagination.spec.ts`: OAuth/App 15/15/1 pages, upstream hasMore and visible first-100 search bound without permission expansion. |
| #12 | `export/cypher-snapshots.test.ts`, real Neo4j integration: two repositories/two commits, repeated imports, lossless manifest/membership and no foreign endpoints. |
| #13 | `e2e/graph-keyboard.spec.ts`: Enter/Space, contextual accessible names, details focus and restoration. |
| #14 | `e2e/modal-accessibility.spec.ts` and export dialog cases: labelled dialogs, Tab containment, Escape, inert background, mobile/error/reconnect and trigger restoration. |
| #15 | `e2e/mobile-responsive.spec.ts`, `e2e/browser-zoom.spec.ts`: control bounds, long names and actual Chromium tabs.setZoom/getZoom=2, not CSS scaling. |
| #16 | `feedback.test.ts`, `feedback-store.test.ts`, `e2e/feedback-delivery.spec.ts`, disposable Redis integration: truthful errors/retry and fixed-choice 30-day aggregate contract. |
| #17 | `stats-client.test.ts`, `e2e/hero-scan-counter.spec.ts`: single-flight bursts, body-read cancellation, real polling timer, unmount, recovery and no page errors. |
| #18 | Landing/picker/retention copy distinguishes experimental Go, App/OAuth scope, source versus derived-data storage; browser primary actions remain covered. |
| #19 | `e2e/hero-scan-counter.spec.ts`: gated offline analysis progress/failure, pageerror checks without substring suppression; full redesigned-flow browser suite. |
| #20 | `npm run typecheck` uses next typegen then strict tsc; hosted CI runs Next → Vinext → typecheck → Next → typecheck without deleting generated outputs. |
| #21 | Satori fflate patch plus `tests/security/development-audit.mjs`: exclusively dev lock entries, reachability/runtime checks, named owner and finite expiry. This is containment, not a clean full audit. |
| #26 | `file-ranking-projection.test.ts`, `file-rankings.test.ts`, `e2e/file-rankings.spec.ts`: normalized full paths, distinct-node score sums, merged evidence and no duplicate React keys. |
| #27 | `parser-runtime-services.test.ts` and real five-language ZIP uploads in inventory/role browser tests; explicit failed grammar requests recover without CSP/vendor modifications. |

Unless prefixed by e2e or tests/security, test filenames in this table are under
tests/unit. Integration paths are stated in full. See each test for assertions.

## Download filename follow-up (#40)

[PR #41](https://github.com/AnasBabari/RepoDNA/pull/41) makes the private Blob
basename equal the canonical client filename and applies the SDK's
`getDownloadUrl` attachment parameter to the already signed URL. Scoped GET
authority and five-minute expiry are unchanged. Existing generic-name blobs
expire normally; no purge or analyzer/exporter byte-version change is needed.

The API/cache regressions cover all four formats on misses/hits, safe basenames,
unchanged integrity metadata and signing parameters. `e2e/cross-origin-export.spec.ts`
serves actual HTTP attachments on a second origin, comparing names/hashes against
real worker-generated JSON/CSV/Cypher/Parquet downloads. It does not pretend a
mock signed URL proves the deployed Blob service: production acceptance must
also download real signed URLs and compare both misses and hits.

## Security and verification boundaries

Fresh 20 October checks: production audit zero; 492 TypeScript and 34 Python
tests; lint zero errors/two existing auth-navigation warnings; Vinext and Next
production builds and both subsequent strict typechecks pass. The new four-format
cross-origin production-browser case passes. Full browser/integration and hosted
results for the follow-up are recorded in PR #41, not inferred from older CI.

Eight high development-only packages still share the braces advisory. Owner
AnasBabari's mitigation expires **25 October 2026 at 00:00 UTC**. No expiry was
extended and no production gate relaxed. CI fails after expiry or risk changes;
before then the owner must patch/remove affected tooling or explicitly reassess.
Closing the containment ticket does not declare the dependency risk eliminated.

No protected-preview bypass, live GitHub App consent/revoke, paid-plan upgrade,
manual production database edits or secret retrieval is part of this acceptance claim.
