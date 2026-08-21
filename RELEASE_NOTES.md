# 🧬 RepoDNA v1.1.0 — Private Repository Beta, Multi-Tier Tracing & UI Polish

Understand any codebase visually in seconds — local-first, deterministic, with zero code execution.

Live Demo: **[repodna-one.vercel.app](https://repodna-one.vercel.app)**

---

### 🌟 What's New in v1.1.0

#### 1. 🔒 Private Repository Ingestion (Beta)
- **GitHub OAuth Integration**: Connect your GitHub account with read-only repository scope.
- **Transience by Design**: Private archives are parsed strictly in memory and never stored to disk or databases.
- **Interactive Repository Selector**: Search, filter, and analyze private and public repos with explicit scope disclosure and one-click disconnect.

#### 2. ⚡ Deep Execution Tracing & Framework Support
- **TypeScript Path Aliases**: Automatically resolves `tsconfig.json` paths (`@/*`, `~/*`).
- **Python `src/` Layouts**: Native support for standard packaging layouts and package roots.
- **Router Hierarchies**: Supports FastAPI prefix routing, NestJS controllers, Express routers, and Next.js App Router route groups.
- **Extended Technology Detection**: Added detection for Prisma, SQLModel, Beanie, NestJS, Vite, Vitest, and Playwright.

#### 3. 🎨 High-Tech UI & Transparent Scrollbars
- **Transparent Scrollbar System**: Universal sleek, transparent scrollbars across all views and containers.
- **Refined Architecture Graph**: React Flow canvas with layer color accents, glowing bezier edges, minimap, and instant **Mermaid diagram export**.
- **Execution Flow Timeline**: Multi-step handler call path visualization.
- **Retina Visual Gallery**: 2x high-resolution screenshots across all workspace views.

#### 4. 🛡️ Privacy-Safe Telemetry & Feedback
- **EU-Hosted PostHog Analytics**: Zero collection of code, repository names, file paths, or symbols.
- **Multi-Tier Rate Limiting**: Upstash Redis sliding window protection (5 public / 20 auth per 10m) with in-memory local fallback.
- **Beta Feedback Modal**: In-app rating and feature request survey to drive community-led development.

---

### 📊 Verification & Test Metrics

- **Unit & Integration Suite**: 43 / 43 Vitest tests passing ✅
- **Python Core Engine**: 22 / 22 unittest tests passing ✅
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
