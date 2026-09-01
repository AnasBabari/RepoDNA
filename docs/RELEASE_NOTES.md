# 🧬 RepoDNA v1.2.0 — Durable Deep Analysis, Graph Exports & Large-Repository Support

Understand any codebase visually in seconds — local-first, deterministic, with zero code execution.

Live Demo: **[repodna-one.vercel.app](https://repodna-one.vercel.app)**

---

### 🌟 What's New in v1.2.0

#### 1. ⚡ Durable Public Deep Analysis
- **Durable workflow engine**: Public repositories are analyzed in a persistent, reconnectable workflow (`app/workflows/analyze-public-repository.ts`) with progress events, cancellation, and status reporting, instead of a single request.
- **Canonical v2 analysis pipeline**: A dedicated graph pipeline (`app/lib/analyzer/v2/`) produces deterministic versioned artifacts covering architecture components, flows, communities, and explicit coverage/completeness metadata.

#### 2. 🗺️ Deterministic Graph Exports
- **JSON, CSV, and Cypher serializers** under a deterministic export contract ([`docs/graph-exports.md`](graph-exports.md)).
- **Architecture TXT report** for tickets, reviews, and offline handoff.
- **Parquet bundles** behind a per-environment feature gate.
- **Caching**: seven-day Vercel Blob cache for public commit-addressed exports plus an opt-in browser IndexedDB cache; when the server cache is unavailable, a browser worker generates the export locally and explains the fallback.

#### 3. 🏗️ Large-Repository Handling
- **Large-repository explorer**: bounded graph compaction (8,000 nodes / 12,000 edges in the artifact; 240 rendered on the live canvas) with preservation of the full inventory and explicit truncation metadata.
- **Git-tree acquisition**: repositories above a size threshold are inventoried via GitHub's commit-tree APIs instead of a single oversized ZIP, with bounded retry and truncation handling.
- **Raised durable limits**: 20,000 candidate files / 100,000 archive entries / 128 MB archive / 192 MB extracted for public durable analysis; browser/private analysis keeps 10,000 files / 20,000 entries / 25 MB / 100 MB.

#### 4. 🔐 Private-Repository Access & Ingestion Hardening
- **GitHub App access as the preferred least-privilege path**: when configured, deployments use per-installation `contents:read` + `metadata:read`; the legacy OAuth `repo` scope (broader access) remains only as a compatibility fallback for deployments not configured for App mode.
- **Transient private analysis**: private deep scans run in ephemeral browser workers over a bounded streaming archive endpoint; source is parsed in memory and never persisted.
- **True bounded streaming decompression** via `fflate` (64 KiB chunks, EOCD structural validation, live byte accounting across every emitted byte).
- **Quarantine semantics**: suspicious compression-ratio entries are terminated and discarded with a `suspicious_compression_ratio` diagnostic while safe files continue — never silently dropped, never globally fatal for an otherwise valid repository.
- **Production fail-closed rate limiting** through Upstash Redis (5 public / 20 authenticated analyses per 10 minutes); the in-memory window is dev-only.

#### 5. 🧬 Tree-sitter Foundation & Cross-Engine Contract
- **Tree-sitter parsing** for Python, JavaScript, TypeScript, TSX, and Go, with bounded AST budgets (25,000 nodes, depth 128) and automatic tree cleanup; the legacy regex analyzer remains a graceful fallback for JavaScript/TypeScript.
- **Canonical versioned schemas** (`schema/repodna.schema.json` v1.1.0, `schema/repodna-v2.schema.json` 2.0.0) with fail-closed runtime validation and a CSP-safe browser validator.
- **Fail-hard cross-engine parity**: CI runs the TypeScript and Python engines over the same fixtures; a missing, crashing, or diverging Python engine fails the build. Local contributors may opt out with `REPODNA_ALLOW_PYTHON_PARITY_SKIP=1` — CI never sets it.
- **Experimental Go analysis**: symbols, imports, calls, `net/http` and Gin/Echo/gorilla-mux route patterns, and architecture graphing — explicitly labelled experimental pending entrypoint recognition and router-attribution hardening. Product copy, README, and contributing tiers all state this distinction.

#### 6. 🎨 Code Graph Explorer & UI
- **Technical Code Graph explorer tab** with semantic code relationships, live constellation interactions, clarified route/cycle states, a minimap, and an Obsidian-style browsing experience.
- **Unified scan coverage** and inventory-driven size classification; a durable public-scan counter on the landing hero.
- Responsive landing/hero polish, draggable-architecture refinements, and PostHog EU privacy-safe analytics.

#### 7. 🧹 Engineering & Process
- **npm canonicalised**: `package-lock.json` is the authoritative lockfile, `"packageManager"` is declared, and the pnpm lockfile/workspace were removed.
- **CONTRIBUTING.md** expanded into a full contributor contract: CI-vs-local quality gates, fixtures and golden assertions, cross-engine parity rules, security-sensitive invariants, and supported-versus-experimental language tiers.
- Community-level cleanups: ignored internal runbooks, pinned CI workflow actions, refreshed demo samples.

---

### 📊 Verification & Test Metrics

- **TypeScript/unit suite**: 277 / 277 Vitest tests passing ✅
- **Python core engine**: 31 / 31 unittest tests passing ✅
- **CI**: engine, visualizer, fail-hard cross-engine parity, and Playwright browser-smoke jobs all green ✅

---

### 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/AnasBabari/RepoDNA.git
cd RepoDNA
python -m pip install -e .
npm ci

# Start visualizer
npm run dev
```

---

## 🧬 RepoDNA v1.1.0 — Private Repository Beta, Multi-Tier Tracing & UI Polish

Understand any codebase visually in seconds — local-first, deterministic, with zero code execution.

Live Demo: **[repodna-one.vercel.app](https://repodna-one.vercel.app)**

---

### 🌟 What's New in v1.1.0

#### 1. 🔒 Private Repository Ingestion (Beta)
- **GitHub private access**: Connect your GitHub account; configured deployments use a GitHub App with per-installation `contents:read` and `metadata:read` permissions, while the legacy OAuth `repo` scope remains a compatibility fallback. RepoDNA itself performs strictly read-only analysis in memory.
- **Transience by Design**: Private archives are parsed strictly in memory and never stored to disk or databases.
- **Interactive Repository Selector**: Search, filter, and analyze private and public repos with explicit scope disclosure and one-click disconnect.

#### 2. ⚡ Deep Execution Tracing & Framework Support
- **TypeScript Path Aliases**: Automatically resolves `tsconfig.json` paths (`@/*`, `~/*`).
- **Python `src/` Layouts**: Native support for standard packaging layouts and package roots.
- **Router Hierarchies**: Supports FastAPI prefix routing, NestJS controllers, Express routers, and Next.js App Router route groups.
- **Extended Technology Detection**: Added detection for Prisma, SQLModel, Beanie, NestJS, Vite, Vitest, and Playwright.

#### 3. 🎨 Draggable Architecture Graph & Persistent Saved Views
- **Draggable Components**: Freely reposition nodes across the interactive React Flow canvas.
- **Per-Repository View Persistence**: Your custom node layout, zoom/pan viewport, and active layer filter automatically persist locally in your browser per repository.
- **Storage Key Privacy**: `localStorage` keys contain a deterministic repository/graph fingerprint (`repodna_view_v1_<hash>`) rather than the raw repository name or URL.
- **1-Click Reset**: Dedicated `↺ Reset View` toolbar button instantly clears saved overrides and restores the default auto-calculated layout.

#### 4. 🌐 Community Reliability & URL Normalization
- **Universal GitHub URL Semantics**: Automatically canonicalizes address-bar URLs (`https://github.com/owner/repo`), subpages (`/tree/...`, `/blob/...`), issues, PRs, missing-protocol shorthand (`github.com/owner/repo` or `owner/repo`), and SSH URLs directly to the repository root.
- **Sanitized User Diagnostics**: Expandable diagnostics panel with a 1-click **📋 Copy Diagnostic** button for technical error reporting with zero confidential repository details.

#### 5. 🛡️ Security Hardening & Bounded Streaming Ingestion
- **Isolated Ingestion**: Web server analysis strictly rejects ambient server PAT tokens (`GITHUB_TOKEN` / `GITHUB_PAT`). Private repository analysis uses only the explicit OAuth credential of the signed-in user.
- **Bounded Streaming ZIP Decompression via `fflate`**: Replaced JSZip with chunk-fed `fflate` streaming decompression enforcing a hard 20,000 all-entry header budget, 1 MB per-file streaming caps with early abort, 200:1 declared compression-ratio heuristic protection, and 100 MB cumulative extracted work budgets counting all emitted bytes.
- **Tree-sitter WASM Resource Lifecycle**: AST parsing wrapped with automatic `tree.delete()` memory cleanup and enforced node budget (`MAX_AST_NODES = 25000`) and depth limits (`MAX_AST_DEPTH = 128`).
- **POST-Only Analysis API**: Removed GET handler on `/api/analyze` to prevent query leakages in logs and proxies.
- **Official Security Policy**: Published comprehensive security policy in [`SECURITY.md`](../SECURITY.md).

---

### 📊 Verification & Test Metrics

- **Unit & Integration Suite**: 117 / 117 Vitest tests passing ✅
- **Python Core Engine**: 28 / 28 unittest tests passing ✅
- **E2E Browser Drag Smoke Test**: Automated Chrome CDP test passing ✅
- **Linter & Typechecks**: 0 ESLint errors, clean production builds ✅

---

### 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/AnasBabari/RepoDNA.git
cd RepoDNA
python -m pip install -e .
npm install

# Start visualizer
npm run dev
```
