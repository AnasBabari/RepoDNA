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
   - Private repository support currently uses GitHub OAuth's `repo` scope because OAuth Apps do not provide read-only private source-code access. RepoDNA itself strictly performs read-only analysis transiently in memory and never modifies repositories or files. Migration to fine-grained GitHub App read-only permissions is planned.

4. **Resource Bounds & Ingestion Defenses**:
   - Bounded download sizes with streaming network byte caps (25 MB default archive limit) that cancel downstream connections immediately upon breach.
   - Ingestion defenses: ZIP ingestion applies candidate file count limits (10,000 max), path traversal rejection, null-byte path validation, path depth limits (32 max), individual file size limits (1 MB), and cumulative extracted content limits (100 MB). Additional streaming decompression hardening remains planned.
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
