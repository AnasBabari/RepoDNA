import { expect, it } from 'vitest';
import { makeV2Fixture, mkEdge } from './export/fixtures';
import { isDrawableGraphEdge, resolutionGapNodeIds, resolutionGaps } from '../../app/lib/resolution-gaps';
import { graphCounts } from '../../app/lib/graph-scope';

it('includes null targets, ambiguous edges, record-only gaps and orphan evidence', () => {
  const project = makeV2Fixture();
  project.edges.push(mkEdge('e-recorded', 'n-file-a', 'n-file-b', 'IMPORTS', 'resolved'));
  project.unresolved.push({ edgeId: 'e-recorded', reason: 'runtime resolution not proven', candidates: [] });
  project.unresolved.push({ edgeId: 'e-orphan', reason: 'edge not retained', candidates: ['n-file-b'] });
  const rows = resolutionGaps(project);
  expect(rows.map((row) => row.id)).toEqual(['e-ambig', 'e-calls', 'e-orphan', 'e-recorded']);
  expect(rows.find((row) => row.id === 'e-orphan')).toMatchObject({ edge: null, reason: 'edge not retained', candidates: ['n-file-b'] });
});

it('preserves canonical reasons and unions all candidate alternatives deterministically', () => {
  const project = makeV2Fixture();
  project.unresolved.push({ edgeId: 'e-calls', reason: 'second reason', candidates: ['n-file-a', 'n-class-c'] });
  const row = resolutionGaps(project).find((gap) => gap.id === 'e-calls')!;
  expect(row.reason).toBe('unresolved call; second reason');
  expect(row.candidates).toEqual(['n-class-c', 'n-file-a']);
  expect(row.edge?.unresolvedExpression).toBe('mystery()');
  expect(row.edge?.evidence.file).toBe('src/a.py');
});

it('includes only relevant source/target/candidate IDs in unresolved-only node selection', () => {
  const ids = resolutionGapNodeIds(resolutionGaps(makeV2Fixture()));
  expect([...ids].sort()).toEqual(['n-class-c', 'n-file-a', 'n-func-f']);
  expect(ids.has('n-dep-req')).toBe(false);
  expect(ids.has('n-route-r')).toBe(false);
});

it('does not spend rendered-edge capacity on null targets or self loops', () => {
  const edges = [mkEdge('null', 'a', null, 'CALLS', 'unresolved'), mkEdge('self', 'a', 'a', 'CALLS', 'unresolved'), mkEdge('drawn', 'a', 'b', 'CALLS', 'ambiguous')];
  expect(edges.filter(isDrawableGraphEdge).map((edge) => edge.id)).toEqual(['drawn']);
});

it('treats dangling endpoints as gaps even when an older artifact flags them resolved', () => {
  const project = makeV2Fixture();
  project.edges.push(mkEdge('dangling', 'n-file-a', 'not-in-artifact', 'IMPORTS', 'resolved'));
  expect(resolutionGaps(project).find((gap) => gap.id === 'dangling')?.reason).toBe('target-node-not-found');
  expect(graphCounts(project).unresolvedRelationships).toBe(3);
});
