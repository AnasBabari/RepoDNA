# Neo4j snapshot identity

Cypher exports use a deterministic SHA-256 snapshot key over repository identity,
source artifact digest and analyzer version. Identical artifact reimports are
idempotent; another repository, commit or analysis artifact is a separate snapshot.
Unpinned artifacts are isolated by their digest, not invented commit metadata.

Every entity, group, unresolved placeholder and relationship is scoped to that
key. Native IDs are `snapshotKey:sourceLocalId`; `originalId` preserves source
IDs on entities/groups/placeholders/ordinary relationships. Endpoint lookups and
memberships use scoped IDs. Canonical JSON/CSV/Parquet IDs do not change.

`RepoDNASnapshot {id: snapshotKey}` stores directly queryable repositorySource,
commitSha, analyzedRef and analyzedAt, plus lossless manifestJson and UTF-8
manifestBase64. MEMBER_OF relationships retain membershipReason and snapshotKey.
Source-local group/candidate ID JSON properties remain canonical evidence; join
them using the snapshot key and originalId rather than treating them as global IDs.

No destructive migration: existing unscoped legacy imports remain untouched.
New exports cannot overwrite them. Exporter 1.0.7 changes derived-export cache
identity without changing artifact TTL or privacy/retention policy.

Run `node tests/integration/run-neo4j-double-import.mjs` for a temporary owned
Neo4j container: hostile-input double import, then three colliding-ID snapshots
(two repositories / two commits), repeated imports, manifest round-trip,
membership provenance and endpoint ownership. Docker absence is an explicit skip,
not proof of successful integration; the actual execution result must be reported.
