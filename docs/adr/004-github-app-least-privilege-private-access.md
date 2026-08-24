# ADR 004: GitHub App Least-Privilege Private Repository Access

## Status
Proposed — accepted as next architectural milestone, implementation pending.

## Context
RepoDNA's private-repository ingestion currently uses a GitHub **OAuth App** with scope `repo` (`app/lib/auth.ts:27`). GitHub OAuth Apps do not offer a read-only private-source scope: `repo` grants full read/write to code, issues, PRs and settings. This contradicts RepoDNA's least-privilege posture:

- RepoDNA is purely read-only and transient (ADR 003) — it never modifies code.
- The granted token capability exceeds operational need.
- Organization private repos require org owner approval of the OAuth App anyway, without fine-grained repo selection.
- `repo` is the last broad privilege remaining after the ingestion hardening in `98eab1c` (streaming fflate, `maxArchiveEntries = 20,000` / `maxFiles = 10,000`, live `totalExtractedBytes` accounting, `SUSPICIOUS_COMPRESSION_RATIO`, EOCD validation in `app/lib/analyzer/ingestion.ts:201-485`).

A GitHub App can request only `contents: read` + `metadata: read` per installation, with per-repository install selection and short-lived installation access tokens. Theismatches the actual need: clone a single selected repo's zipball transiently in memory.

The bounded-decompression milestone (`98eab1c`) is now verified shipped on Vercel and can be locked. The next privilege-reduction is this migration.

## Decision
Migrate private-repository auth from GitHub OAuth App to a GitHub App:

1. Create a RepoDNA GitHub App requesting minimal permissions:
   - `contents: read` (read source/archives)
   - `metadata: read` (list repos, required by GitHub)
   - No `administration`, `issues`, `pull_requests`, `workflows`, etc.
   - `user: email` via OIDC/optional for display name only if needed.
2. Use the GitHub App installation flow (`/api/auth` via Auth.js GitHub provider in App mode or `octokit/auth-app` + user-to-server OAuth inside the App). Prefer Auth.js GitHub-App provider if available, else custom `POST /api/auth/github-app/callback` exchanging `code -> installation_token` via `POST https://api.github.com/app/installations/{id}/access_tokens` signed with the App private key (RS256 JWT, 10m expiry).
3. Persist only short-lived installation access tokens (1h, auto-refreshed) in the encrypted Auth.js JWT (`token.accessToken` today in `app/lib/auth.ts:39`), never a long-lived PAT. `AUTH_GITHUB_ID/SECRET` are replaced by `GITHUB_APP_ID`, `GHAM_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID/SECRET`.
4. Ingestion change is minimal: `fetchGitHubRepo(url, limits, accessToken)` in `app/lib/analyzer/ingestion.ts:538-562` already isolates per-request `accessToken` and never falls back to `GITHUB_TOKEN`/`GITHUB_PAT` (invariant in `tests/unit/security-invariants.test.ts:8`). With a GitHub App, the same header `Authorization: Bearer <installation_token>` works against `api.github.com/repos/{owner}/{repo}/zipball/HEAD`; alternatively use `GET /repos/{owner}/{repo}/zipball/{ref}` with the installation token.
5. Repository listing (`GET /api/github/repositories`) switches from `GET https://api.github.com/user/repos` with the OAuth token to ` GET https://api.github.com/installation/repositories` (installation-scoped) or `GET https://api.github.com/user/installations` + per-installation listing, still returning only sanitized `{ fullName, isPrivate, language, defaultBranch, updatedAt }`.
6. Keep OAuth App as **fallback during rollout** behind `GITHUB_AUTH_MODE = "oauth" | "github-app"` env toggle so existing Vercel preview deploys do not break. Default new behavior is `github-app` when `GITHUB_APP_ID` is present.
7. Docs & UX: update `SECURITY.md:27`, `README.md:38`, `PrivateRepoPicker.tsx:120`, `RELEASE_NOTES.md:12` scope disclosures from “`repo` scope required by OAuth Apps” to “GitHub App `contents:read` (per-repository install)”.

## Consequences
- **Positive**: Least-privilege alignment — token can only read contents of repositories the user explicitly installed the App on; org owners get per-repo install control; token is short-lived and installation-scoped; eliminates the broad `repo` contradiction highlighted in the post-`98eab1c` review.
- **Positive**: No change to the core ingestion security boundary — `fflate` streaming, `maxArchiveEntries` header-bomb cap, live `entryBytes`/`totalExtractedBytes` accounting, ratio heuristic, path-traversal and depth checks remain authoritative.
- **Negative**: One-time GitHub App creation + Vercel env migration (`GITHUB_APP_ID`, `GHAM_PRIVATE_KEY`, webhook secret if enabling install events). Existing users must re-authorize (one click, per-repo install).
- **Negative**: Slightly more token-exchange code (App JWT signing) vs plain OAuth; must be covered by new `tests/unit/github-app-auth.test.ts` asserting no ambient `GITHUB_TOKEN` fallback still holds and that only `contents:read` is requested.

## Alternatives Considered
- **Keep OAuth `repo` with disclosure**: honest but leaves the largest remaining privilege-reduction unrealized; rejected as the review already flags this as the top residual risk.
- **Fine-grained PAT (classic)**: not suitable for third-party web app flows; GitHub Apps are the platform-recommended path for server-mediated user-selected private repo access.
- **Device flow / CLI-only PAT**: breaks web UX and still requires broad `repo` locally.

## Rollout Steps
1. Create GitHub App in github.com/settings/apps, set callback to `<prod>/api/auth/callback/github` and request `contents:read`, `metadata:read`.
2. Add `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_APP_CLIENT_ID/SECRET` to `.env.example` + Vercel env.
3. Implement `app/lib/github-app.ts` (JWT signing + installation token exchange + refresh) and adapt `app/lib/auth.ts` provider selection.
4. Update `app/api/github/repositories/route.ts` to use installation endpoints when in App mode.
5. Add security-invariant test: captured request headers never contain a repo-write scope token; `GITHUB_TOKEN` ambient still rejected.
6. Update docs (`SECURITY.md`, `README.md`, `threat-model.md`, `RELEASE_NOTES.md`) and ship behind feature flag; cut over production OAuth App only after 2 weeks soak.
7. Enforce `NODE_ENV=production` requires `GITHUB_APP_ID` (fail-closed), mirroring `app/lib/ratelimit.ts` Upstash invariant.

## References
- `app/lib/auth.ts:27` — current `scope: 'read:user user:email repo'`
- `app/lib/analyzer/ingestion.ts:559-575` — isolated per-request `accessToken` with api zipball
- `app/lib/ratelimit.ts:105-133` — production fail-closed pattern to reuse for App env
- `SECURITY.md:28`, `README.md:38` — current scope transparency disclosures
- Commit `98eab1c` — bounded `fflate` ingestion (locked)
