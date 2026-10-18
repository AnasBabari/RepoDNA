# Recorded file-ranking semantics

The canonical graph ranks nodes, not files. The workspace projection groups
those recorded centrality rows by repository-relative full path. It does not
change canonical node identities, centrality evidence or machine-readable
graph exports. No cache migration is necessary for this display-time fix.

- Normalize backslashes, repeated separators and `.` path components. Preserve
  case, directory names and literal encoded characters. Never group by basename.
- Ignore missing nodes, empty/absolute/parent-traversing paths and non-file
  locations (repository/workspace/package/directory/dependency/external system).
- Add scores from distinct ranked node IDs in each file. Repeated rows for the
  same node contribute their maximum finite nonnegative score once, not twice.
  Merge all distinct per-node reasons, labelled with their qualified name/kind.
- Sum in stable node-ID order. Sort files by descending score, breaking ties
  by the full normalized path in code-unit order. Sort merged reasons likewise.
- `mostConnectedFiles` uses the same grouped importance rows. `highCouplingFiles`
  separately groups only the canonical high-coupling rows; it does not reassess
  every file against a new threshold or infer results for unranked files.

These are sums of recorded node-link scores, **not unique file-to-file
dependencies or distinct dependents**. A link internal to one file can contribute
at both endpoints. Canonical centrality lists may already be capped (currently
ten rows per ranking); grouping them does not recover omitted nodes or establish
an exhaustive repository-wide top-file ranking. The technical overview states
this scope; its cards show at most two reasons and disclose additional summaries.
The TXT report keeps canonical per-node findings and labels link counts honestly.

Regressions cover normalized-path aliases, distinct same-basename files, case,
duplicate rows, invalid records, merged evidence, deterministic ordering and
unchanged canonical JSON. Real browser checks inspect rows, scores, both symbol
names, JSON downloads and duplicate-key console warnings on nanoGPT.
