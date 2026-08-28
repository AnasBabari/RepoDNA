# ADR 004: GitHub App Least-Privilege Private Repository Access

## Status
Accepted — implementation complete; production App configuration and private-repository soak validation remain operational rollout tasks.

## Context
RepoDNA originally used a GitHub **OAuth App** with scope `repo` (`app/lib/auth.ts`). GitHub OAuth Apps do not offer a read-only private-source scope: `repo` grants full read/write to code, issues, PRs and settings. This contradicted RepoDNA's least-privilege posture:

- RepoDNA is purely read-only and transient (ADR 003) — it never modifies code.
- The granted token capability exceeds operational need.
- Organization private repos require org owner approval of the OAuth App anyway, without fine-grained repo selection.
- `repo` is the last broad privilege remaining after the ingestion hardening in `98eab1c` (streaming fflate, `maxArchiveEntries = 20,000` / `maxFiles = 10,000`, live `totalExtractedBytes` accounting, `SUSPICIOUS_COMPRESSION_RATIO`, EOCD validation in `app/lib/analyzer/ingestion.ts:201-485`).

A GitHub App can request only `contents: read` + `metadata: read` per installation, with per-repository install selection and short-lived installation access tokens. Theismatches the actual need: clone a single selected repo's zipball transiently in memory.

The bounded-decompression milestone (`98eab1c`) is locked, and the App-mode implementation is now shipped behind the existing configuration toggle. OAuth remains available as a compatibility fallback while production installation coverage is validated.

## Decision
Migrate private-repository auth from GitHub OAuth App to a GitHub App:

1. Create a RepoDNA GitHub App requesting minimal permissions:
   - `contents: read` (read source/archives)
   - `metadata: read` (list repos, required by GitHub)
   - No `administration`, `issues`, `pull_requests`, `workflows`, etc.
   - `user: email` via OIDC/optional for display name only if needed.
2. Use the GitHub App installation flow (`/api/auth` via Auth.js GitHub provider in App mode or `octokit/auth-app` + user-to-server OAuth inside the App). Prefer Auth.js GitHub-App provider if available, else custom `POST /api/auth/github-app/callback` exchanging `code -> installation_token` via `POST https://api.github.com/app/installations/{id}/access_tokens` signed with the App private key (RS256 JWT, 10m expiry).
3. Keep only the short-lived GitHub user access token from the current Auth.js login in the encrypted Auth.js JWT (`token.accessToken` in `app/lib/auth.ts`), never a long-lived PAT. In App mode, the login requests identity scopes only; repository access is constrained by the user's App installation and selected repositories. The installation-token exchange helper is available for explicitly scoped server calls and does not persist its result. `AUTH_GITHUB_ID/SECRET` remain the OAuth fallback; App deployments use `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_CLIENT_ID/SECRET`.
4. Ingestion change is minimal: `fetchGitHubRepo(url, limits, accessToken)` in `app/lib/analyzer/ingestion.ts:538-562` already isolates per-request `accessToken` and never falls back to `GITHUB_TOKEN`/`GITHUB_PAT` (invariant in `tests/unit/security-invariants.test.ts:8`). With a GitHub App, the same header `Authorization: Bearer <installation_token>` works against `api.github.com/repos/{owner}/{repo}/zipball/HEAD`; alternatively use `GET /repos/{owner}/{repo}/zipball/{ref}` with the installation token.
5. Repository listing (`GET /api/github/repositories`) uses `GET https://api.github.com/user/installations` followed by `GET https://api.github.com/user/installations/{id}/repositories` with the App user token, returning only sanitized `{ fullName, isPrivate, language, defaultBranch, updatedAt }`. It paginates, deduplicates, and never uses `/user/repos` in App mode.
6. Keep OAuth App as **fallback during rollout** behind `GITHUB_AUTH_MODE = "oauth" | "github-app"` env toggle so existing Vercel preview deploys do not break. Automatic App selection requires all App credentials; an explicit production App-mode selection fails closed if credentials are incomplete.
7. Docs & UX: update `SECURITY.md:27`, `README.md:38`, `PrivateRepoPicker.tsx:120`, `RELEASE_NOTES.md:12` scope disclosures from “`repo` scope required by OAuth Apps” to “GitHub App `contents:read` (per-repository install)”.

## Consequences
- **Positive**: Least-privilege alignment — token can only read contents of repositories the user explicitly installed the App on; org owners get per-repo install control; token is short-lived and installation-scoped; eliminates the broad `repo` contradiction highlighted in the post-`98eab1c` review.
- **Positive**: No change to the core ingestion security boundary — `fflate` streaming, `maxArchiveEntries` header-bomb cap, live `entryBytes`/`totalExtractedBytes` accounting, ratio heuristic, path-traversal and depth checks remain authoritative.
- **Negative**: One-time GitHub App creation + Vercel env migration (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, and `GITHUB_APP_CLIENT_SECRET`). Existing users must re-authorize (one click, per-repo install).
- **Negative**: Slightly more token-exchange code (App JWT signing) vs plain OAuth; must be covered by new `tests/unit/github-app-auth.test.ts` asserting no ambient `GITHUB_TOKEN` fallback still holds and that only `contents:read` is requested.

## Alternatives Considered
- **Keep OAuth `repo` with disclosure**: honest but leaves the largest remaining privilege-reduction unrealized; rejected as the review already flags this as the top residual risk.
- **Fine-grained PAT (classic)**: not suitable for third-party web app flows; GitHub Apps are the platform-recommended path for server-mediated user-selected private repo access.
- **Device flow / CLI-only PAT**: breaks web UX and still requires broad `repo` locally.

## Rollout Steps
1. Create GitHub App in github.com/settings/apps, set callback to `<prod>/api/auth/callback/github` and request `contents:read`, `metadata:read`.
2. Add `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_APP_CLIENT_ID/SECRET` to `.env.example` + Vercel env.
3. ✅ Implement `app/lib/github-app.ts` (JWT signing, installation token exchange, and paginated installation listing) and adapt `app/lib/auth.ts` provider selection.
4. ✅ Update `app/api/github/repositories/route.ts` to use installation endpoints when in App mode.
5. ✅ Add helper and route tests covering explicit API headers, pagination, incomplete credentials, and no ambient PAT fallback.
6. ✅ Update docs and ship behind the feature toggle; validate production installation coverage before removing OAuth fallback.
7. ✅ Enforce production App-mode configuration completeness (fail-closed), mirroring `app/lib/ratelimit.ts` Upstash invariant.

## References
- `app/lib/auth.ts:27` — current `scope: 'read:user user:email repo'`
- `app/lib/analyzer/ingestion.ts:559-575` — isolated per-request `accessToken` with api zipball
- `app/lib/ratelimit.ts:105-133` — production fail-closed pattern to reuse for App env
- `SECURITY.md:28`, `README.md:38` — current scope transparency disclosures
- Commit `98eab1c` — bounded `fflate` ingestion (locked)
