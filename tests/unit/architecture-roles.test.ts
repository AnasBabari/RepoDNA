import { expect, it } from 'vitest';
import { buildArchitecture, classifyFile, classificationConfidence } from '../../app/lib/analyzer/graph';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import type { FileRecord } from '../../app/lib/types';

it.each(['src/requests/session.py', 'app/main.py', 'src/backend.ts', 'src/client/http.py', 'app/views/users.py'])('does not invent UI behavior for %s', (path) => {
  const [category, evidence] = classifyFile(path, new Set(), new Set());
  expect(category).toBe('other');
  expect(classificationConfidence(category, evidence)).toBe(0.35);
  expect(evidence).not.toContain('frontend container path');
});
it.each(['src/App.tsx', 'app/page.tsx', 'app/layout.tsx', 'frontend/styles.css', 'src/components/Widget.vue'])('retains explicit presentation evidence for %s', (path) => {
  expect(classifyFile(path, new Set(), new Set())).toEqual(['frontend', ['presentation-capable file extension']]);
});
it('distinguishes component symbols from weaker directory hints and keeps API precedence', () => {
  expect(classifyFile('src/index.js', new Set(), new Set(['component']))).toEqual(['frontend', ['UI component symbol']]);
  const [category, evidence] = classifyFile('frontend/helpers.ts', new Set(), new Set());
  expect(classificationConfidence(category, evidence)).toBe(0.65);
  expect(classifyFile('app/api/users/route.ts', new Set(['app/api/users/route.ts']), new Set(['component']))[0]).toBe('api');
});
it('uses the weakest member heuristic rather than letting one component inflate a whole layer', () => {
  const files = ['src/App.tsx', 'frontend/helpers.ts', 'app/main.py'].map((path) => ({ id: path, path, parsed: true, error: null })) as FileRecord[];
  const { architecture } = buildArchitecture(files, [], [], []);
  expect(architecture.components.find((area) => area.type === 'frontend')).toMatchObject({ confidence: 0.65, files: ['frontend/helpers.ts', 'src/App.tsx'] });
  expect(architecture.components.find((area) => area.type === 'other')).toMatchObject({ name: 'Unclassified files', confidence: 0.35, evidence: ['generic src/app container; no specific layer evidence'] });
});
it('maps actual Python src/app and actual React/Next components from syntax evidence', async () => {
  const file = (path: string, content: string) => ({ path, content, size: content.length, hash: path });
  const project = await analyzeRepositoryFiles({ files: [file('src/requests/session.py', 'class Session:\n    pass\n'), file('app/main.py', 'def run():\n    pass\n'), file('src/App.tsx', 'export function App() { return <main />; }'), file('app/page.tsx', 'export default function Page() { return <main />; }')], skipped: [], name: 'roles', source: 'local://roles' });
  const frontend = project.architecture.components.find((area) => area.type === 'frontend')!;
  expect(frontend.files).toEqual(['app/page.tsx', 'src/App.tsx']);
  expect(frontend.evidence).toContain('UI component symbol');
  expect(frontend.confidence).toBe(0.94);
});
