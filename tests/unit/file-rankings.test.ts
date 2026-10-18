import { expect, it } from 'vitest';
import { aggregateFileRankings } from '../../app/lib/schema/file-rankings';
import { mkNode } from './export/fixtures';

it('counts a recorded node only once while retaining all distinct reasons', () => {
  const nodes = new Map([['a', mkNode('a', 'function', 'train', './src//train.py')]]);
  const entries = [
    { nodeId: 'a', score: 3, reasons: ['first'] },
    { nodeId: 'a', score: 2, reasons: ['second', 'first'] },
  ];
  const [file] = aggregateFileRankings(nodes, entries);
  expect(file.file).toBe('src/train.py');
  expect(file.score).toBe(3);
  expect(file.reasons).toHaveLength(2);
  expect(aggregateFileRankings(nodes, entries.toReversed())).toEqual([file]);
});

it('preserves directory, case and literal encoded-path identities, sorting score ties stably', () => {
  const paths = ['tools/train.py', 'src/train.py', 'src/Train.py', 'src%2Ftrain.py'];
  const nodes = new Map(paths.map((path) => [path, mkNode(path, 'file', 'train.py', path)]));
  const rows = paths.map((nodeId) => ({ nodeId, score: 4, reasons: [] }));
  const output = aggregateFileRankings(nodes, rows);
  expect(output.map((item) => item.file)).toEqual(paths.toSorted());
  expect(aggregateFileRankings(nodes, rows.toReversed())).toEqual(output);
});

it('does not manufacture file rankings from missing, non-file, unsafe or invalid quantitative records', () => {
  const nodes = new Map([
    ['empty', mkNode('empty', 'function', 'empty', '')],
    ['directory', mkNode('directory', 'directory', 'src', 'src')],
    ['parent', mkNode('parent', 'file', 'bad', 'src/../bad.py')],
    ['absolute', mkNode('absolute', 'file', 'bad', 'C:\\bad.py')],
    ['valid', mkNode('valid', 'file', 'valid', 'src/valid.py')],
  ]);
  const rows = [...nodes.keys(), 'missing'].map((nodeId) => ({ nodeId, score: 2, reasons: [] }));
  expect(aggregateFileRankings(nodes, rows)).toEqual([{ file: 'src/valid.py', score: 2, reasons: [] }]);
  expect(aggregateFileRankings(nodes, [NaN, Infinity, -1].map((score) => ({ nodeId: 'valid', score, reasons: [] })))).toEqual([]);
});
