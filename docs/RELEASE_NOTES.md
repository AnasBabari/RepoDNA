# 🧬 RepoDNA v1.1.0 — Private Repository Beta, Multi-Tier Tracing & UI Polish

Understand any codebase visually in seconds — local-first, deterministic, with zero code execution.

Live Demo: **[repodna-one.vercel.app](https://repodna-one.vercel.app)**

---

### 🌟 What's New in v1.1.0

#### 1. 🔒 Private Repository Ingestion (Beta)
- **GitHub OAuth Integration**: Connect your GitHub account with transparent scope handling (using OAuth `repo` scope required by GitHub OAuth Apps for private archive access; RepoDNA itself performs strictly read-only analysis in memory).
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
