# GitHub revision identity

## Input and scope

Root repository URLs (including supported SSH/shorthand forms) resolve `HEAD`.
`/tree/ref`, `/blob/ref/path` and `/commit/<full-40-hex-SHA>` select a revision.
Every scan covers the **whole repository** at that revision: a directory or file
suffix is not a scan filter. Input/progress retain the requested URL; the workspace
displays the actual full commit and this scope explicitly. Explicit revisions do
not short-circuit to a bundled sample.

## Conservative resolution

An encoded slash inside a ref, e.g. `feature%2Freview`, identifies one ref. A full
40-character SHA also identifies one candidate, even with a deep file suffix.
Otherwise, probe possible slash boundaries (excluding the final blob filename).
At most eight candidates and one shared eight-second deadline are allowed.
No match, multiple matches (even to the same SHA), invalid/oversized candidate
sets and upstream failures are explicit errors; **never substitute HEAD**.
Encode slashes or use a full commit URL to disambiguate. Public resolution uses
no ambient or session credential; private resolution uses only the authorized
session token. Credentials are never serialized into workflow input or artifacts.

## Acquisition and portable identity

Resolved source acquisition pins every archive/tree path to the same SHA.
The legacy server fallback also resolves root URLs before acquisition, rather
than leaving a successful public fallback's commit unknown. Worker and inline
results, v1 projections, JSON, CSV, Parquet, Cypher and TXT
retain `commitSha` and `analyzedRef`. Canonical `analyzedRef` is the immutable
SHA, not a mutable branch/tag label. Public `source` is the repository's
`/tree/<SHA>` URL. Requested ref is public workflow progress/input only.
Two refs pointing to identical content may safely share the same artifact.

Explicit private revisions use the authenticated tree endpoint, retain SHA
identity, and return a `private:` source. The legacy private root ZIP path is
not newly pinned: missing identity stays unknown, never invented. Private scans
remain in-memory and do not enter the public artifact store or scan counter.

## Cache migration

Analyzer 2.0.6 / exporter 1.0.6 use new lookup namespaces. Public artifacts must
match full SHA, SHA-valued analyzedRef and exact owner/repository source identity
before acceptance or persistence. Old artifacts expire under their original TTL;
there is no destructive migration, schema-version, retention or privacy change.

## Verification boundaries

Unit fixtures exercise actual ZIP extraction, tree-first and oversized-archive
fallback, workflow scheduling, private acquisition and serializer identity.
Browser fixtures replace external GitHub/storage calls but use actual local
source parsing, WASM workers, workspace and downloaded exports. They do not
prove live GitHub/Vercel authentication or protected-preview acceptance.
