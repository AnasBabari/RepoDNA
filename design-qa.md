# Dark split-layout implementation QA

final result: passed

Scope: the user's selected dark direction #2, its landing interactions, and the
shared workspace visual finish. This is **not** an application-wide launch
approval or a claim that the remaining analyzer/auth/accessibility issues are
resolved. These are review-branch changes, not merged or deployed to production.

## Reference and comparison

Selected reference:
`C:/Users/Babar/.codex/generated_images/01a0248f-582c-76c1-9cb3-4989111fc902/exec-480f7ca2-ebbb-490f-9913-c57ea1b09ba0.png`

Evidence directory:
`C:/Users/Babar/.codex/visualizations/2026/08/21/01a0248f-582c-76c1-9cb3-4989111fc902/repodna-reaudit-2026-10-16/`

- `14-reviewed-comparison.png`: source on the left and the final implementation
  on the right in one comparison input, both normalized to 1488 × 1056.
- `13-dark-desktop-reviewed.png`: final desktop implementation.
- `11-dark-mobile-final.png`: 390px landing, compact two-row header and three
  source actions. Subsequent change only deduplicates preview file paths.
- `08-dark-mobile-graph.png` and `09-dark-mobile-architecture.png`: intermediate
  workspace visual captures; later automated bounds/tap-target checks cover the
  final 44px header controls.

## Comparison passes and repairs

| Surface | Evidence and result |
| --- | --- |
| Typography | Left-aligned three-line hero, solid cyan final line, restrained Geist type and plain descriptions. Increased desktop heading size after the first side-by-side pass; restored sans-serif primary-button text. No gradient headline. |
| Layout/spacing | Split hero with real preview; divided import/sample lists beneath it. Mobile stacks sections, keeps sign-in with the brand, and presents three usable source actions. Corrected the initial overly tall mobile header. |
| Colors/tokens | Charcoal page and raised surfaces, off-white text, muted secondary text and cyan actions. Removed landing/workspace grid backgrounds and decorative header/glow effects; retained meaningful graph/status colors. No white page surfaces. |
| Imagery/graph | Real React Flow rendering of seven actual bundled sample entities and up to six actual import/dependency edges. The generated reference's fictional paths/relationships are intentionally not copied. Preview labels identify the selected projection, unresolved count and actual commit. Deduplicated file/module paths in its file list. No generated raster artwork or fake graph illustration is shipped. |
| Copy | Replaced genome/stream/sandbox jargon with understandable import actions. Go is experimental. Samples are explicitly snapshots, not fresh scans. Disclosure distinguishes GitHub App/OAuth, browser/server parsing, optional IndexedDB findings and localStorage layouts. |
| Icons/states | Existing consistent Lucide family; explicit text labels. Loading and unavailable preview states preserve imports. GitHub uses the existing repository/branch icon rather than a new brand asset (non-blocking P3 difference). |
| Responsiveness | Landing tested at 390/820/1024px and desktop. Graph/Architecture title width and action bounds tested at 320/390/480/768/1440px. Small-screen header actions have minimum 44px targets. Canvas pan/zoom, graph dragging and detail sheets retain their behavior. |
| Accessibility | Semantic headings, navigation, labeled form/input, keyboard-accessible source actions, native file pickers, visible focus, polite counter state and reduced-motion treatment. Tests verify keyboard focus and same-document lifecycle cancellation. This is not formal accessibility certification. |

## Functional evidence

- Five landing browser cases pass: actual graph provenance/bounds, sample
  navigation, keyboard/file import at three widths, and failed-preview fallback.
- Two additional source-ingestion cases pass for the real directory picker and
  a ZIP built from actual Express fixture source (not precomputed JSON). The
  first directory run caught a live-FileList regression caused by immediately
  clearing its input; that reset was removed, and both import cases plus all
  five landing cases passed on rerun.
- Eight responsive workspace cases pass, including the five added control-bound
  cases. The preceding full flag-off browser pass was 35 passed / one gated skip.
- The expanded flag-on full run was 40 passed / one disabled-feature-case skip,
  including readable Parquet output. Together with the two source-import cases
  and the earlier flag-off run, both feature-gate states were exercised.
- Analysis lifecycle, six workspace views, graph/export contracts and counter
  lifecycle remain covered by the existing browser suite.
- 295 unit/static integration checks and 31 Python tests pass. Both production
  builders and typecheck pass in both builder orders; production npm audit has
  zero findings. Lint has zero errors and two pre-existing auth-navigation
  warnings, not hidden with global suppression.

## Remaining boundaries

- Issue #15 still needs the specific long-repository-name plus real 200% browser
  zoom acceptance case; viewport-width tests are not represented as that test.
- Existing overview/canonical completeness contradictions, extraction-limit
  reporting, graph compaction semantics, authentication edge cases and modal
  accessibility remain in their separate issues. Styling does not resolve them.
- Production/private-account verification, hosted CI and deployment are pending.
- The local preview may show an unavailable scan count without local Redis
  configuration; it does not invent a count. The development-only React/CSP
  warning remains; CSP was not weakened to hide it.

No outstanding P0/P1/P2 fidelity defects were found in the selected dark layout
after the comparison/repair passes. Review the remaining issue backlog separately.
