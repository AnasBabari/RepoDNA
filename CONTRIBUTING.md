# Contributing

RepoDNA welcomes focused parser, detector, graph, fixture, and visualizer improvements.

Before opening a change:

1. Install the Python package and Node dependencies.
2. Add a minimal fixture that demonstrates the structural pattern.
3. Add or update a golden assertion.
4. Run the engine tests, lint, and production build.
5. Preserve the invariant that repository code is never executed.

New heuristics should expose evidence and calibrated confidence. Avoid labels such as “dead code” when the analyzer can only prove “potentially unused.”

