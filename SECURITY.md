# Security Policy

## Supported Versions

RepoDNA provides active security maintenance for the latest release on the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

---

## Security Model & Guarantees

RepoDNA is architected around **Zero Code Execution**:

1. **Static Analysis Only**:
   - Analyzed source code is parsed exclusively as static text via WebAssembly-compiled Tree-sitter parsers and lightweight AST parsers.
   - Submitted source code is **never compiled, required, imported, executed, or run** in any runtime environment.

2. **Zero Source Code Persistence**:
   - Ingested files are analyzed strictly in memory.
   - Source code from public and private repositories is never written to persistent databases, disks, or server logs.

3. **Isolated Credential Model & Scope Transparency**:
   - Web server ingestion paths never inherit ambient server Personal Access Tokens (`GITHUB_TOKEN` / `GITHUB_PAT`).
   - When configured, private repository support uses a GitHub App user token with per-installation `contents:read` and `metadata:read` permissions; users select which repositories the App may access. The legacy OAuth App `repo` scope remains an explicit compatibility fallback only when App mode is not configured. RepoDNA itself strictly performs read-only analysis transiently in memory and never modifies repositories or files.

4. **Resource Bounds & Streaming Ingestion Defenses**:
   - Bounded download sizes with streaming network byte caps (25 MB default archive limit) that cancel downstream connections immediately upon breach.
   - Streaming Decompression Defense via `fflate`: Archive buffers are fed in bounded 64 KiB chunks with a hard all-entry cap (20,000 max entries) against header bombs, candidate file limits (10,000 max), path traversal rejection, null-byte path validation, path depth limits (32 max), per-entry uncompressed byte caps (1 MB max, skipping oversized entries early), declared compression-ratio heuristic guards (aborting on >200:1 ratio past 256 KB floor), and cumulative extracted content limits (100 MB max, counting all emitted bytes).
   - Syntax parsers operate under AST depth caps (`MAX_AST_DEPTH = 128`), node budgets (`MAX_AST_NODES = 25000`), item collection limits, and automatic Tree-sitter WASM cleanup (`tree.delete()`).

---

## Reporting a Vulnerability

If you discover a potential security vulnerability in RepoDNA, please do not open a public GitHub issue.

Please report vulnerabilities privately via:
- **GitHub Security Advisories**: Submit a private advisory via [GitHub Security Advisory](https://github.com/AnasBabari/RepoDNA/security/advisories/new)
- **Email**: `babarianas11@gmail.com`

Please include:
- A description of the vulnerability and potential impact.
- Steps or a minimal proof-of-concept repository to reproduce the issue.
- Details of your operating system and environment if relevant.

We will acknowledge receipt within 48 hours and work with you on a resolution before any public disclosure.
