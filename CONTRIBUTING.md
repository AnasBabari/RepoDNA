# Contributing

RepoDNA welcomes focused parser, detector, graph, fixture, and visualizer improvements.

## Package Manager

RepoDNA uses **npm** as its canonical dependency manager. `package-lock.json` is the
authoritative lockfile — install dependencies with `npm ci` so the validated dependency
tree is reproduced exactly. Do not commit a second lockfile (e.g. `pnpm-lock.yaml` or
`yarn.lock`); dual lockfiles drift silently and can make deployment platforms install
with a different manager than the one CI validates.

## Before opening a change

1. Install the Python package and Node dependencies.
2. Add a minimal fixture that demonstrates the structural pattern.
3. Add or update a golden assertion.
4. Run the engine tests, lint, and production build.
5. Preserve the invariant that repository code is never executed.

New heuristics should expose evidence and calibrated confidence. Avoid labels such as “dead code” when the analyzer can only prove “potentially unused.”

