/**
 * Keep only actionable directed cycles.
 *
 * A self-reference is useful as a graph relationship (for example, a
 * recursive call), but it is not an architectural dependency cycle. The
 * filter also protects the UI and exports when they receive older artifacts
 * produced before the analyzer made this distinction.
 */
export function filterMeaningfulDependencyCycles(
  cycles: readonly (readonly string[])[],
): string[][] {
  return cycles
    .filter((cycle) => cycle.length > 1 && new Set(cycle).size === cycle.length)
    .map((cycle) => [...cycle]);
}
