# Primary technology and architecture-role evidence

Analyzer 2.0.5 / exporter 1.0.5 supersede path-only frontend inference. New cache
namespaces prevent prior classifications being served as fresh analysis. Schema,
retention, consent and private-data policies are unchanged.

## Primary technology

The overview uses the largest positive finite recorded language proportion,
not object-key order or the first technology in an alphabetically sorted list.
Language proportions describe acquired source LOC, not unacquired repository
content. Ties use English alphabetical ordering as an explicit deterministic
fallback, not proof that one equally-sized language is more important.

If proportions are absent, use positive recorded language file counts. If those
are also absent, a single detected framework may supply a label with an explicit
missing-language-evidence note. Multiple frameworks do not establish a winner.
Configuration, Markdown, Unknown and External labels are not primary languages.
The technology list orders known languages by this same evidence, then detected
frameworks and remaining technology labels. It does not fabricate technologies.

Legacy snapshots benefit from this display ordering, but their canonical
language/architecture records are not silently rewritten. Exported JSON keeps
the original evidence. Reanalyze old snapshots to obtain current role inference.

## Frontend roles and confidence

- Request-handler, service, database, worker and test rules retain precedence.
- A retained component symbol supplies a frontend role at heuristic 0.94.
  JS/JSX and TSX component symbols require an uppercase callable with observed
  JSX syntax or a recorded call to an imported React createElement binding.
  Strings, comments, uppercase names and unbound React names are insufficient.
  Nested JSX belongs to its own callable, not an unrelated enclosing function.
- Presentation-capable extensions (JSX, TSX, Vue, Svelte, HTML, CSS, SCSS, Sass,
  Less) supply a weaker 0.82 role hint, not proof of runtime behavior. Unsupported
  syntax remains unsupported for parse coverage even if its extension is a hint.
- JS/TS files in explicit frontend/client/components/pages/views/ui directories
  supply a 0.65 directory heuristic, with UI behavior explicitly unverified.
  Python files in client/ or views/ do not inherit that browser-code heuristic.
- Generic src/ and app/ containers alone are neutral. Without another role
  signal, files remain `other`, labelled "Unclassified files", at 0.35 rather
  than being claimed as frontend or application core.
- A component group's score is the minimum of its members' role-rule scores;
  one strong symbol does not inflate weaker path-only members. These are fixed
  heuristic weights, not calibrated probabilities, accuracy or runtime proof.
  Existing API/database/test weights remain 0.94; other recognized roles 0.82.

The TypeScript and Python architecture classifiers use matching rules, evidence
strings and grouping weights. Parser implementation details can still differ.
No repository code is run, and no extra AST traversal or unbounded UI state is
introduced: component evidence is collected during the existing bounded walk.
# Pre-merge TypeScript regression

The 18 October review found that plain `.ts` arrow functions still used uppercase
names as component evidence. They now share the imported-React-factory rule with
JavaScript and TSX. A capitalized numeric factory stays neutral; an imported
`createElement` call may establish a component. Parser and end-to-end analyzer
unit regressions cover both cases. Analyzer 2.0.7 isolates caches from old results.

