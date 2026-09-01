# Threat Model & Mitigation Matrix

This document outlines the threat vectors considered in the design of RepoDNA and their concrete technical mitigations.

---

## Threat Matrix

| Threat Vector | Description | Severity | Mitigation in RepoDNA |
|---|---|---|---|
| **Malicious Archive / ZIP Bomb** | Attacker crafts a ZIP with high compression ratio (e.g. 5 MB expanding to 10 GB), millions of files, or duplicate paths. | **Critical** | Streaming decompression via `fflate` with bounded ingestion: 64 KiB chunk-fed `Unzip` (`UnzipInflate`/`UnzipPassThrough`), EOCD structural validation, `maxArchiveEntries = 20,000` header-bomb cap (`TOO_MANY_ARCHIVE_ENTRIES`), `maxFiles = 10,000` candidate cap (`TOO_MANY_FILES`), duplicate normalized-path rejection, per-entry live cap `maxFileBytes = 1 MB` with early `terminate()` and discarded buffers, cumulative `maxTotalExtractedBytes = 100 MB` counting every emitted byte including skipped oversized files (`EXTRACTED_TOO_LARGE`), declared ratio quarantine >200:1 after 256 KB floor (entry stream `terminate()`d and buffers discarded, skipped with a `suspicious_compression_ratio` diagnostic while analysis of safe files continues—no `413` is raised for a quarantined entry), and `maxArchiveBytes = 25 MB` network cap with streaming `reader.cancel()`. These are the browser/private defaults; public durable analyses raise them to 20,000 files / 100,000 entries / 128 MB archive / 192 MB extracted with honest partial inventories (`allowPartialOnFileLimit`). Local folder byte limits use `File.size` before decoding so UTF-16 string length cannot under-count input. |
| **Path Traversal / Arbitrary File Overwrite** | Archive entries contain `../../etc/passwd`, absolute paths (`/root`), or Windows drive letters (`C:\`). | **Critical** | `validatePath`/`normalizeArchivePath` reject absolute paths, drive letters, `..` segments and null bytes before extraction; path depth is capped at 32 segments and paths longer than 4,096 characters are skipped. `PATH_TRAVERSAL` fails closed at the incremental `onfile` boundary, not post-extraction. |
| **Malformed or hostile analysis artifact** | A user imports a huge or schema-invalid RepoDNA JSON file, or a cached Blob is corrupted. | **High** | Imported artifacts are capped at 128 MB before reading and validated through the version-aware schema loader. The CSP-safe browser validator checks every graph node and edge with a bounded error list. Cached public artifacts are size checked and schema validated before use; malformed entries are evicted. |
| **Malicious Syntax / Parser Bomb** | Deeply nested ASTs, 1 MB single-line JS strings, or recursive macros designed to crash memory/CPU. | **High** | Tree-sitter budgets `MAX_AST_DEPTH = 128`, `MAX_AST_NODES = 25,000` with item collection limits and guaranteed `tree.delete()` cleanup. Syntax parsing runs in try-catch with graceful degradation (`parseSuccessRate` reduction and diagnostics) without failing the whole repo. Future: wall-clock analysis budget / Worker isolation. |
| **Private Code / Token Leakage** | Private repository source code or user GitHub access tokens stored on server disk or exposed in error responses. | **Critical** | Server access tokens are stored strictly inside encrypted HTTP-only JWTs. Private code is decompressed in RAM, parsed, and immediately garbage collected. Zero disk or DB persistence. Ingestion never inherits `GITHUB_TOKEN`/`GITHUB_PAT`; only the explicit per-request user token is used. Configured App mode uses per-installation `contents:read` + `metadata:read`; the legacy OAuth `repo` scope is an explicit compatibility fallback only when App mode is not configured (see ADR 004). |
| **Server Log Leakage** | Internal server logs revealing private repository names or customer proprietary project structures. | **High** | Production server logs never print repository URLs or names. They use HMAC-SHA256 hashed identifiers (`repoIdHash`) and masked IP addresses (`127.0.***.***`). |
| **Telemetry & Analytics Egress** | Sensitive source code or filenames sent to third-party analytics (PostHog). | **High** | Strict allowlist sanitizer strips all code, file paths, repository URLs, and credentials before dispatch. Autocapture and session recording are disabled. |
| **Denial of Service / Rate Limit Bypass** | Unauthenticated bots bombarding analysis or export endpoints to exhaust server compute or GitHub API quotas. | **Medium** | Analysis and export routes use separate sliding-window multi-tier limits through Upstash Redis. Production fails closed with `503 RATE_LIMIT_UNAVAILABLE` if Upstash is unavailable or unconfigured; dev/test falls back to an in-memory window. Client-side browser analysis remains the fallback. Small auxiliary request bodies are bounded even where they do not invoke the analyzer. |

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
