# RepoDNA

**Understand any codebase visually.**

[Open the live Vercel web application](https://repodna-one.vercel.app)

RepoDNA turns an unfamiliar Python, JavaScript, or TypeScript repository into an interactive structural map: files, symbols, imports, routes, databases, external systems, architecture layers, execution traces, impact slices, and an onboarding tour.

It is deterministic, local-first, and does not use an LLM. The analyzer reads source code as text and **never executes repository code**.

---

## Screenshots

### Repository Overview
![RepoDNA repository overview](docs/screenshots/overview.png)

### Interactive Architecture Map
![RepoDNA interactive architecture map](docs/screenshots/architecture.png)

### Route Execution Tracing
![RepoDNA route execution tracing](docs/screenshots/routes-trace.png)

### Change Impact & Dependencies
![RepoDNA change impact and dependencies](docs/screenshots/dependencies.png)

---

## Web App & Analysis Options

### 1. Public GitHub Repositories
Paste any public GitHub repository link to decode architecture layers, execution traces, dependency graphs, and entry points in seconds.
- **Universal URL Support**: Accepts standard links (`https://github.com/owner/repo`), subpages (`.../tree/main`, `.../blob/develop/app.py`), issues/PRs, short syntax (`github.com/owner/repo`, `owner/repo`), and SSH URLs.
- **Draggable Layout & Saved Views**: Freely reposition nodes on the canvas. Your custom layout, zoom level, and active layer filter automatically persist per repository in your browser (with a 1-click `↺ Reset View` option to restore defaults).

### 2. Private Repositories (Beta)
Sign in with GitHub to access your private repositories:
- **Scope Transparency**: GitHub OAuth requires read-only repository scope to fetch repository archives. RepoDNA parses ASTs transiently in memory, isolated from ambient server tokens, and never modifies or stores code.
- **Revocation**: Easily disconnect access at any time via the UI or GitHub Settings.
- **Transience**: OAuth tokens and repository code are never saved to disk or databases.

### 3. Client-Side & Zero-Server Analysis
- **Local Folder Picker**: Select any project directory from your computer (`webkitdirectory`). All parsing runs 100% inside your browser tab.
- **Local .zip / .json Upload**: Drop a zipped source archive or an existing `repodna.json` analysis.
- **Automatic Fallback**: If server analysis is rate-limited or unavailable, the web app automatically falls back to in-browser parsing.

---

## API Specifications

### Analysis Endpoint (`/api/analyze`)

- **Method**: `POST` (POST-only for credential and query privacy)
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "url": "https://github.com/owner/repository"
  }
  ```

#### HTTP Status Codes

| Status | Code | Description |
|---|---|---|
| `200` | `SUCCESS` | Repository successfully parsed and architecture resolved. |
| `400` | `INVALID_REQUEST` / `INVALID_GITHUB_URL` / `MALFORMED_JSON` / `PATH_TRAVERSAL` | Missing parameters, invalid GitHub URL, malformed JSON, or path traversal detected in archive. |
| `404` | `REPO_NOT_FOUND` | Public GitHub repository not found or repository is private / insufficient permissions. |
| `413` | `ARCHIVE_TOO_LARGE` / `EXTRACTED_TOO_LARGE` / `TOO_MANY_FILES` | Repository exceeds enforced size/count resource limits. |
| `429` | `RATE_LIMITED` | IP sliding window exceeded (5 req/10m public, 20 req/10m authenticated). Includes `Retry-After`. |
| `502` | `UPSTREAM_GITHUB_ERROR` | Upstream GitHub API rate limit, gateway error, or organization SAML approval needed. |
| `503` | `RATE_LIMIT_UNAVAILABLE` | Rate limiting infrastructure failure (fail-closed, triggers client browser fallback). |
| `504` | `FETCH_TIMEOUT` | Upstream GitHub download timed out after 20 seconds. |

### Private Repository Listing (`GET /api/github/repositories`)
- Authenticated endpoint returning sanitized metadata (`fullName`, `isPrivate`, `language`, `defaultBranch`, `updatedAt`) for authorized user repositories with pagination and query search. Never logs or sends repo names to analytics.

### Feedback Survey (`POST /api/feedback`)
- Collects usefulness scores (1-5), primary use cases, desired capabilities, and optional 500-char feedback without PII with enforced payload bounds (<= 16 KB).

---

## Enforced Resource Limits & Quotas

| Limit | Maximum | Action upon breach |
|---|---|---|
| **Public Rate Limit** | 5 analyses / 10 min per IP | Returns `429 RATE_LIMITED` |
| **Authenticated Rate Limit** | 20 analyses / 10 min per user | Returns `429 RATE_LIMITED` |
| **Repository files** | 10,000 files | Returns `413 TOO_MANY_FILES` |
| **Individual file size** | 1 MB (1,000,000 bytes) | Skipped with diagnostic (`exceeds_file_size_limit`) |
| **Compressed archive** | 25 MB (26,214,400 bytes) | Returns `413 ARCHIVE_TOO_LARGE` |
| **Total extracted content** | 100 MB (104,857,600 bytes) | Returns `413 EXTRACTED_TOO_LARGE` (ZIP bomb protection) |
| **GitHub fetch timeout** | 20 seconds | Returns `504 FETCH_TIMEOUT` |

---

## Environment Variables

For production deployments on Vercel:

```bash
# Authentication (Auth.js / GitHub OAuth)
AUTH_SECRET="your-32-byte-auth-secret"
AUTH_GITHUB_ID="your-github-oauth-client-id"
AUTH_GITHUB_SECRET="your-github-oauth-client-secret"

# Privacy-Safe Analytics (PostHog EU)
NEXT_PUBLIC_POSTHOG_KEY="your-posthog-project-api-key"
NEXT_PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"

# Multi-Tier Rate Limiting (Upstash Redis)
UPSTASH_REDIS_REST_URL="https://your-upstash-redis.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-upstash-token"
```

---

## Testing, Schema Parity & Quality Assurance

```bash
# Run all 104 Vitest unit, security invariant, and smoke tests
npm run test:unit

# Run Python core test suite (28 unit, parity, and conformance tests)
npm run test:python

# Run Chrome E2E browser smoke test for drag & view persistence
node tests/smoke/browser-drag-persistence.mjs

# Run ESLint + Vitest + Next.js build
npm test

# Run native Vercel Next.js build
npm run build:vercel
```

---

## Canonical Contract & Security

- **Formal Schema**: Analysis artifacts conform to [`schema/repodna.schema.json`](schema/repodna.schema.json) (v1.1.0).
- **Security Model**: Detailed zero-code-execution guarantees and vulnerability policy in [`SECURITY.md`](SECURITY.md).
- **Threat Model**: Complete threat matrix and mitigations in [`docs/threat-model.md`](docs/threat-model.md).
- **Static Analysis Boundaries**: Detailed analysis limits and confidence scoring in [`docs/analysis-limitations.md`](docs/analysis-limitations.md).
- **Architecture Decisions**: Full list of ADRs in [`docs/adr/`](docs/adr/).

---

## License

[MIT](LICENSE)
