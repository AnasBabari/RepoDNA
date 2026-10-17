import { expect, it } from 'vitest';
import { projectV2ForWorkspace } from '../../app/lib/schema/v2-viewer-projection';
import { makeV2Fixture, mkNode } from './export/fixtures';

it('aggregates ranked symbols by normalized full file path without changing the canonical graph', () => {
  const project = makeV2Fixture({
    nodes: [
      mkNode('one', 'function', 'train', './src//train.py'),
      mkNode('two', 'class', 'Model', 'src\\train.py'),
      mkNode('three', 'function', 'train', 'tools/train.py'),
    ],
    centrality: {
      mostConnected: [
        { nodeId: 'one', score: 11, inDegree: 8, outDegree: 3 },
        { nodeId: 'two', score: 7, inDegree: 2, outDegree: 5 },
        { nodeId: 'three', score: 4, inDegree: 1, outDegree: 3 },
      ],
      highCoupling: [{ nodeId: 'one', connections: 11 }, { nodeId: 'two', connections: 7 }],
      godNodes: [],
    },
  });
  const original = structuredClone(project);
  const view = projectV2ForWorkspace(project);
  expect(view.important_files.map(({ file, score }) => ({ file, score }))).toEqual([
    { file: 'src/train.py', score: 18 }, { file: 'tools/train.py', score: 4 },
  ]);
  expect(view.important_files[0].reasons.join(' ')).toContain('train');
  expect(view.important_files[0].reasons.join(' ')).toContain('Model');
  expect(view.importantFiles).toEqual(view.important_files);
  expect(view.metrics.mostConnectedFiles).toEqual([
    { file: 'src/train.py', connections: 18 }, { file: 'tools/train.py', connections: 4 },
  ]);
  expect(view.metrics.highCouplingFiles).toEqual([{ file: 'src/train.py', connections: 18 }]);
  expect(project).toEqual(original);
});
