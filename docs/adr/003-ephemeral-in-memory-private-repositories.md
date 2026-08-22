# ADR 003: Ephemeral In-Memory Processing for Private Repositories

## Status
Accepted

## Context
Developers analyzing private, proprietary repositories require ironclad assurances that their intellectual property and source code are never retained, stored, leaked, or exposed to third parties.

## Decision
1. Private repository archives are fetched directly into RAM and parsed transiently in memory.
2. Raw file contents are **never persisted to disk, databases, caches, or logs**.
3. Production server logs record only salted HMAC-SHA256 repository hashes (`repoIdHash`) with masked client IPs.
4. Telemetry strictly allowlists metrics and aggregate counts; source code, file paths, and commit hashes are unconditionally excluded.

## Consequences
- **Positive**: Enterprise-grade privacy boundary. Low liability surface for the service operator.
- **Negative**: Re-analyzing private repositories requires re-fetching from GitHub unless processed client-side via local folder or ZIP upload.
