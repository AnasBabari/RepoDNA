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
Paste any public GitHub repository link (e.g. `https://github.com/pytorch/pytorch` or `https://github.com/fastapi/fastapi`) to decode architecture layers, execution traces, dependency graphs, and entry points in seconds.

### 2. Private Repositories (Beta)
Sign in with GitHub to access your private repositories:
- **Scope Transparency**: GitHub OAuth requires the `repo` scope to read private repositories. RepoDNA executes read-only `GET` requests, parses ASTs transiently in memory, and never modifies or stores code.
- **Revocation**: Easily disconnect access at any time via the UI or GitHub Settings.
- **Transience**: OAuth tokens and repository code are never saved to disk or databases.

### 3. Client-Side & Zero-Server Analysis
- **Local Folder Picker**: Select any project directory from your computer (`webkitdirectory`). All parsing runs 100% inside your browser tab.
- **Local .zip / .json Upload**: Drop a zipped source archive or an existing `repodna.json` analysis.
- **Automatic Fallback**: If server analysis is rate-limited or unavailable, the web app automatically falls back to in-browser parsing.

---

## API Specifications

### Analysis Endpoint (`/api/analyze`)

- **Method**: `POST` (or `GET ?url=https://github.com/owner/repo`)
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
- Collects usefulness scores (1-5), primary use cases, desired capabilities, and optional 500-char feedback without PII.

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

## Testing & Quality Assurance

```bash
# Run all 43 Vitest unit tests (auth, quotas, detection, AST, graph, ingestion, API, analytics)
npm run test:unit

# Run ESLint + Vitest + Vinext build
npm test

# Run native Vercel Next.js build
npm run build:vercel

# Run Python core test suite (22 unit tests)
npm run test:python
```

---

## Privacy & Safety Model

- **Zero Code Execution**: Source files are parsed purely as text. RepoDNA never runs `npm install`, `pip install`, `eval`, application entry points, shell scripts, or build tasks.
- **Zero Server Persistence**: Source code and archive payloads are never saved to disk on the server or logged to monitoring.
- **Privacy-Safe Analytics (PostHog EU)**: Explicit opt-in banner. All analytics events strictly sanitize payloads, stripping repository URLs, names, file paths, symbol names, and code snippets.
- **Pseudonymous User IDs**: User identifiers in analytics use one-way salted SHA-256 hashes to prevent linkage back to GitHub accounts.

---

## License

[MIT](LICENSE)
