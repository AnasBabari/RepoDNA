# Threat Model & Mitigation Matrix

This document outlines the threat vectors considered in the design of RepoDNA and their concrete technical mitigations.

---

## Threat Matrix

| Threat Vector | Description | Severity | Mitigation in RepoDNA |
|---|---|---|---|
| **Malicious Archive / ZIP Bomb** | Attacker crafts a ZIP with high compression ratio (e.g. 5 MB expanding to 10 GB) or millions of files. | **Critical** | Decompression enforces hard limits: `maxArchiveBytes = 25MB`, `maxFileBytes = 1MB`, `maxTotalExtractedBytes = 100MB`, `maxFiles = 10,000`. |
| **Path Traversal / Arbitrary File Overwrite** | Archive entries contain `../../etc/passwd`, absolute paths (`/root`), or Windows drive letters (`C:\`). | **Critical** | `sanitizePath` normalizes all separators, strips drive letters, rejects leading slashes, and fails closed with `PATH_TRAVERSAL_DETECTED` if resolving outside root. |
| **Malicious Syntax / Parser Bomb** | Deeply nested ASTs, 1 MB single-line JS strings, or recursive macros designed to crash memory/CPU. | **High** | Analysis budgets and per-file timeouts. Syntax parsing runs in try-catch with graceful degradation (`parseSuccessRate` reduction and diagnostics) without failing the whole repo. |
| **Private Code / Token Leakage** | Private repository source code or user GitHub OAuth access tokens stored on server disk or exposed in error responses. | **Critical** | Server access tokens are stored strictly inside encrypted HTTP-only JWTs. Private code is decompressed in RAM, parsed, and immediately garbage collected. Zero disk or DB persistence. |
| **Server Log Leakage** | Internal server logs revealing private repository names or customer proprietary project structures. | **High** | Production server logs never print repository URLs or names. They use HMAC-SHA256 hashed identifiers (`repoIdHash`) and masked IP addresses (`127.0.***.***`). |
| **Telemetry & Analytics Egress** | Sensitive source code or filenames sent to third-party analytics (PostHog). | **High** | Strict allowlist sanitizer strips all code, file paths, repository URLs, and credentials before dispatch. Autocapture and session recording are disabled. |
| **Denial of Service / Rate Limit Bypass** | Unauthenticated bots bombarding serverless endpoints to exhaust server compute or GitHub API quotas. | **Medium** | Sliding-window multi-tier rate limiting (5 req/10m public, 20 req/10m authenticated) with client IP hashing and seamless fallback to client-side browser analysis. |

---

## Architectural Trust Boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│                      Untrusted World                        │
│   Public GitHub URLs · Private Repositories · User ZIPs     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                [ Ingestion Boundary Filter ]
            - Path traversal validation
            - File size & count quotas
            - Binary/media skipping
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Isolated In-Memory Parsing RAM                 │
│   Python AST / TypeScript Static AST Analysis               │
│   (Zero execution · Zero subprocesses · Zero persistence)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                [ Structural Metadata Graph ]
            - Architecture Components
            - HTTP Routes & Flow Paths
            - Technology Boundaries
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   RepoDNA Canonical Output                  │
│   Validated JSON Schema (v1.1.0) · Visual React Flow Canvas │
└─────────────────────────────────────────────────────────────┘
```
