import { describe, expect, it } from 'vitest';

import { detectDependencyCycles } from '../../app/lib/analyzer/v2/analytics';
import { mkEdge } from './export/fixtures';

describe('v2 dependency cycle analytics', () => {
  it('ignores self-referential calls while retaining the graph edge elsewhere', () => {
    const cycles = detectDependencyCycles([
      mkEdge('self-call', 'function:load', 'function:load', 'CALLS', 'resolved'),
    ]);

    expect(cycles).toEqual([]);
  });

  it('preserves directed traversal order when canonicalizing a cycle', () => {
    const cycles = detectDependencyCycles([
      mkEdge('a-to-c', 'a', 'c', 'IMPORTS', 'resolved'),
      mkEdge('c-to-b', 'c', 'b', 'IMPORTS', 'resolved'),
      mkEdge('b-to-a', 'b', 'a', 'IMPORTS', 'resolved'),
      // A rotated duplicate must not create a second displayed cycle.
      mkEdge('c-to-b-duplicate', 'c', 'b', 'DEPENDS_ON', 'resolved'),
    ]);

    expect(cycles).toEqual([['a', 'c', 'b']]);
  });
});
