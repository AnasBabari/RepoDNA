# Contributing

RepoDNA welcomes focused parser, detector, graph, fixture, and visualizer improvements.

## Package Manager

RepoDNA uses **npm** as its canonical dependency manager. `package-lock.json` is the
authoritative lockfile — install dependencies with `npm ci` so the validated dependency
tree is reproduced exactly. Do not commit a second lockfile (e.g. `pnpm-lock.yaml` or
`yarn.lock`); dual lockfiles drift silently and can make deployment platforms install
with a different manager than the one CI validates.

## Prerequisites

- **Node.js >= 22.13.0** (CI runs Node 22)
- **npm** — the canonical package manager (see below)
- **Python >= 3.11** (CI runs 3.12) — required for the Python engine, cross-engine parity, and `npm run test:python`
- Docker (optional) — only for the Neo4j export integration test, which skips itself when Docker is unavailable
- Playwright Chromium (optional) — installed on demand for E2E: `npx playwright install --with-deps chromium`

## Setup

```bash
npm ci                      # Node dependencies; postinstall copies Tree-sitter grammar WASM into public/tree-sitter/
python -m pip install -e .  # installs the Python engine (repodna) in editable mode
```

If parser grammars fail to load, re-run the copy step explicitly: `npm run copy:wasm`.

## Quality gates

CI enforces the following on every push and pull request (`.github/workflows/ci.yml`):

| Gate | Command | CI job |
|---|---|---|
| Python engine suite | `python -m unittest discover -s tests -v` | engine |
| Lint | `npm run lint` | visualizer |
| Typecheck | `npm run typecheck` | visualizer |
| TS unit / security / contract tests | `npm run test:unit` | visualizer |
| Cross-engine parity (fail-hard) | `npx vitest run tests/unit/parity.test.ts` | parity |
| Vinext production build | `npm run build` | visualizer |
| Vercel/Next production build | `npm run build:vercel` | visualizer |
| Playwright browser contracts | `npm run test:e2e` | browser-smoke |

Locally, run the gates relevant to your change — not every gate for every change:

```bash
npm run lint && npm run typecheck   # always
npm run test:unit                   # analyzer, schema, security, export, and parity tests
npm run test:python                 # Python engine suite (wraps unittest discover)
npm run build                       # when touching the app or analyzer
npm run build:vercel                # when touching routes, config, or deployment behavior
npm run test:e2e                    # browser contracts; set REPODNA_E2E_PORT if 3000 is busy
```

Full local validation is expected before pushing non-trivial changes. Docs-only changes need `git diff --check` and a careful read; CI covers the rest.

## Repository layout

- `app/` — the web application (components, API routes, durable workflows)
- `app/lib/analyzer/` — TypeScript engine: `parser/` (Tree-sitter grammar registry and per-language parsers), `analyzers/` (per-language structural extraction), `ingestion.ts` (bounded GitHub/ZIP acquisition), `graph.ts` (metrics, entrypoints, flows, architecture), `v2/` (durable deep-analysis pipeline)
- `core/repodna/` — the Python engine (ingestion, engine, graph, detection, analyzers, models, CLI)
- `schema/` — the canonical, versioned JSON schemas both engines target
- `tests/fixtures/` — minimal repositories demonstrating structural patterns
- `tests/unit/` — TypeScript engine, security, export, and parity tests
- `tests/golden/` — golden artifacts asserted by the Python engine suite (`tests/test_engine.py`)
- `tests/integration/` — Docker-gated Neo4j export verification
- `e2e/` — Playwright browser contracts

## Analyzer conventions

- Repository code is **static text only** — never compiled, imported, required, or executed. This invariant has no exceptions.
- New grammars must be registered in `app/lib/analyzer/parser/registry.ts` and their WASM assets added to `scripts/copy-tree-sitter-wasm.mjs`.
- All parsing is bounded: AST node budget (`MAX_AST_NODES = 25000`), depth cap (`MAX_AST_DEPTH = 128`), and per-file collection caps (e.g. 1,000 symbols / 500 imports / 2,000 calls in the Go parser). A parser that can be exhausted by hostile input is a bug.
- Parse failures degrade that file only (partial quality, parser notice, `parsed: false`) — never the whole analysis.
- Route and framework claims carry calibrated numeric confidence and skip test files (`isTestFile`), which are fixtures rather than the repository's real HTTP surface.

## Fixtures & golden assertions

When adding or changing structural detection:

1. Add a **minimal fixture** under `tests/fixtures/<name>/` that demonstrates the pattern and nothing else.
2. Assert the TypeScript engine's output structure in `tests/unit/` (see `golden.test.ts` for the style: structural assertions over symbols, imports, routes, architecture).
3. If the Python engine implements the capability, add or update the golden artifact under `tests/golden/` consumed by `tests/test_engine.py`.
4. If both engines implement it, add a cross-engine parity case (see below).

Keep fixtures deterministic: no network access, no timestamps, no randomness.

## Cross-engine parity

- CI runs `tests/unit/parity.test.ts` **fail-hard** with both engines installed. A missing, crashing, or diverging Python engine fails CI — it can never silently pass.
- `REPODNA_ALLOW_PYTHON_PARITY_SKIP=1` is a **local-only** escape hatch for contributors without a Python environment. Never set it in CI, and never merge a change that relies on it being set.
- **Parity is required only for capabilities intentionally implemented by both engines.** A TypeScript-only capability is not automatically a parity failure — but its product copy and engine-specific documentation must not imply Python support (and vice versa).
- Adding a capability to both engines means adding the shared fixture and the parity assertions **in the same change**.
- Never weaken a parity assertion to make a diff pass; fix the divergence.

## Language support tiers

- **Supported:** Python, JavaScript, TypeScript — full user-facing analysis.
- **Experimental:** Go — parser, symbols, imports, calls, routes, and architecture graphing participate in the normal pipeline, with documented gaps (entrypoint recognition, router attribution, dedicated fixtures).

An experimental language is promoted to supported only when its **core user-facing analysis** is covered by representative fixtures and tests and its known major semantic gaps are resolved — and the wording change (README, package metadata, UI) lands in the same PR as the promotion. Do not broaden an experimental language's advertised scope just to justify a stronger label.

## Security-sensitive changes

Changes touching ingestion, authentication, rate limiting, CSP, or export caching must preserve:

- **Zero code execution** and **zero source persistence** — source is parsed in memory and never written to disk, databases, or logs.
- **Bounded ingestion.** Current defaults: 10,000 candidate files, 20,000 archive entries, 1 MB per file, 25 MB compressed, 100 MB extracted; public durable analyses raise these (20,000 files / 100,000 entries / 128 MB / 192 MB) and produce honest partial inventories instead of hard failures.
- **Quarantine semantics.** Suspicious compression-ratio entries are terminated and discarded with a `suspicious_compression_ratio` diagnostic while safe files continue — never silently dropped, never globally fatal. Every emitted byte, including quarantined entries, counts toward cumulative budgets.
- **Log hygiene.** No repository URLs, source code, or tokens in logs; hashed identifiers and masked IPs only.

Any change to limits or threat surface must update the README limits table, `SECURITY.md`, and `docs/threat-model.md` **in the same change** — documentation drift around security contracts is treated as a defect.

## Evidence & calibrated claims

New heuristics should expose evidence and calibrated confidence. Avoid labels such as “dead code” when the analyzer can only prove “potentially unused.”

## Pull request expectations

- Small, single-concern PRs. Behavior-preserving refactors are separate from behavior changes.
- All required CI gates green.
- Update release notes (`docs/RELEASE_NOTES.md`) and user-facing documentation when **externally observable behavior changes**; internal cleanups and test refactors do not need release-note entries.
- Never commit credentials, `.env` values, or real private-repository content as fixtures.

## Reporting vulnerabilities

Do not open public issues for security vulnerabilities. Follow the private disclosure process in [`SECURITY.md`](SECURITY.md).
