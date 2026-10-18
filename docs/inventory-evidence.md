# Inventory evidence and coverage

Analyzer 2.0.4 and exporter 1.0.4 use the following definitions. New cache
namespaces prevent older proxy counts being reused as fresh analysis. Existing
artifacts keep their TTL; no cache or private-data policy is changed.

## Observed paths and source outcomes

- Classify unique observed paths, with ignored then generated paths taking
  precedence. Remaining paths partition into supported source, recognized but
  unsupported source, evidence/configuration files, and other assets.
- Supported source extensions are Python (`.py`, `.pyi`), JS/TS and JSX/TSX
  (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`), and experimental Go (`.go`).
  See `app/lib/analyzer/source-policy.ts` for the explicit unsupported taxonomy.
- Makefiles, Dockerfiles, manifests and Markdown remain analysis evidence; they
  are not supported source and do not lower its parse percentage.
- First-party source = supported + recognized unsupported source. Acquired-source
  LOC excludes unacquired files; it is not a whole-repository LOC guarantee.
- Supported source = complete + partial + failed + skipped + unprocessed.
  Parsed = complete + partial, so partial is an overlapping detail of parsed,
  not a category to add again. Coverage = parsed / supported, or 100% if no
  supported source paths were observed. This never proves runtime completeness.
- Skipped supported paths are deduplicated by path. Unsupported files are not
  parse failures. Truncated Git trees and acquisition limits still mean unknown
  paths may exist; do not extrapolate observed counts into whole-repo totals.
- `sourceInventory.classificationVersion=2` identifies these definitions. Older
  unsupported counts may include documentation/assets; UI and TXT label those
  counts unrecorded and their coverage denominator legacy until a fresh scan.

## Package roots and declared dependencies

- Packages deduplicate by ecosystem + manifest directory. An npm workspace root
  and acquired child package manifests are distinct roots. Multiple Python
  manifests in the same directory describe one root. Requirements-only files
  do not establish a distributable package root.
- Declarations deduplicate for totals by ecosystem + nearest owning package root
  + normalized dependency name. The same name declared by two packages counts
  twice. Scope totals overlap: runtime + development is not a valid grand total.
- Preserve runtime/development/optional/peer/build/unspecified scopes, group
  names and evidence file paths. Requirements declarations remain unspecified;
  filenames alone do not establish deployment intent. Python extras are optional.
- Read package.json, pyproject.toml (PEP 621, Poetry, dependency groups), Pipfile,
  requirements includes, setup.cfg and go.mod as data. No setup.py, package build,
  script, import, dependency install, network include or LLM execution occurs.
- Python names case-fold and normalize runs of dot/underscore/hyphen to hyphen;
  npm names case-fold; Go module names preserve case. Never retain version values,
  index URLs or dependency URLs, which can carry credentials.
- Dynamic setup.py metadata, unsupported Cargo/Maven/Gradle manifests, malformed
  data, missing/cyclic includes and acquisition omissions make evidence partial:
  retained counts are lower bounds. Legacy artifacts without evidence return
  unavailable status and null counts, never language/import-count substitutes.

## Bounds and portable output

Manifest parsing is bounded to 2,000 files, 1 MB per input, 50,000 retained
declaration records, 100,000 expansion/declaration visits, depth 16 for includes,
and 32 MiB cumulatively expanded bytes (repeated includes are charged again).
Crossing a bound stops or omits that work and emits a fixed diagnostic, without
copying parser errors or untrusted values into diagnostic messages.

Overview disclosures show at most 20 roots/declaration records/problems; TXT
uses its existing bounded lists. All retained manifest/source evidence travels
in graph JSON and CSV/Parquet `manifest.json`; Cypher carries the same manifest
as base64 UTF-8 comment data. These formats do not recover unacquired facts.

Browser grammar inputs are fetched as same-origin bytes to avoid upstream
string-loader Node detection through incomplete process shims (#27). Failed
parser promises are removed so a transient asset failure can be retried. Node
filesystem grammar loading and the existing CSP are unchanged.

References: [pyproject specification](https://packaging.python.org/en/latest/specifications/pyproject-toml/),
[dependency groups](https://packaging.python.org/en/latest/specifications/dependency-groups/),
[PEP 735](https://peps.python.org/pep-0735/),
[smol-toml](https://github.com/squirrelchat/smol-toml).
