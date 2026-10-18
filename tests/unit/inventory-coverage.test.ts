import { zipSync, strToU8 } from 'fflate';
import { expect, it } from 'vitest';
import { extractFromZip, extractFromFileList } from '../../app/lib/analyzer/ingestion';
import { analyzeRepositoryV2 } from '../../app/lib/analyzer/v2/pipeline';
import { validateRepoDNAProjectV2 } from '../../app/lib/schema/safe-validator';
import { classifySourcePaths, reconcileSourceOutcomes } from '../../app/lib/analyzer/source-inventory';
import type { FileRecord } from '../../app/lib/types';

it('Requests-like Python files plus Makefiles produce 100% supported-source coverage', async () => {
  const entries = Object.fromEntries(Array.from({ length: 37 }, (_, n) => [`requests/src/module${n}.py`, strToU8('import urllib3\n\ndef parse():\n    pass\n')]));
  for (let n = 0; n < 8; n++) entries[`requests/build${n}/Makefile`] = strToU8('all:\n\techo not executed\n');
  entries['requests/pyproject.toml'] = strToU8('[project]\nname="requests-like"\ndependencies=["urllib3", "charset-normalizer", "certifi", "idna"]\n');
  const discovery = await extractFromZip(zipSync(entries), 'requests-like');
  expect(discovery.files.some((file) => file.path.endsWith('Makefile'))).toBe(true);
  expect(discovery.inventory).toMatchObject({ firstPartySourceFileCount: 37, supportedSourceFileCount: 37, unsupportedSourceFileCount: 0, evidenceFileCount: 9 });
  const project = await analyzeRepositoryV2({ ...discovery, source: 'local://requests-like' });
  expect(project.coverage).toMatchObject({ percentage: 100, parsed: 37, partial: 0, unsupported: 0 });
  expect(project.inventory).toMatchObject({ packageCount: 1, declaredDependencyCount: 4, sourceOutcomes: { supported: 37, complete: 37, partial: 0, failed: 0, skipped: 0, unprocessed: 0 } });
  expect(project.edges.filter((edge) => edge.type === 'DEPENDS_ON').length).toBeGreaterThan(30);
  expect(validateRepoDNAProjectV2(project).errors).toEqual([]);
});
it('partitions observed paths and reconciles overlapping parsed/partial counts explicitly', () => {
  const paths = ['ok.py', 'partial.py', 'failed.py', 'skip.py', 'pending.py', 'style.css', 'Makefile', 'README.md', 'image.png', 'node_modules/lib.js', '__generated__/x.ts'];
  const counts = classifySourcePaths(paths, [{ path: 'skip.py' }, { path: 'skip.py' }]);
  expect(counts).toMatchObject({ totalFileCount: 11, firstPartySourceFileCount: 6, supportedSourceFileCount: 5, unsupportedSourceFileCount: 1, evidenceFileCount: 2, otherFileCount: 1, ignoredFileCount: 1, generatedFileCount: 1, skippedSupportedSourceFileCount: 1 });
  const files = [{ path: 'ok.py', parsed: true, error: null }, { path: 'partial.py', parsed: true, error: 'SOURCE_EXTRACTION_LIMIT_REACHED' }, { path: 'failed.py', parsed: false, error: 'SOURCE_PARSE_FAILED' }, { path: 'pending.py', parsed: false, error: null }] as FileRecord[];
  expect(reconcileSourceOutcomes(files, counts)).toEqual({ supported: 5, complete: 1, partial: 1, failed: 1, skipped: 1, unprocessed: 1 });
});
it('uses identical taxonomy for local uploads and rejects duplicate relative paths', async () => {
  const files = ['src/a.py', 'Makefile', 'src/b.rs'].map((path) => ({ name: path.split('/').pop(), webkitRelativePath: `root/${path}`, size: 5, text: async () => 'pass\n' }) as unknown as File);
  const result = await extractFromFileList(files);
  expect(result.inventory).toMatchObject({ acquisitionMode: 'local-folder', firstPartySourceFileCount: 2, supportedSourceFileCount: 1, unsupportedSourceFileCount: 1, evidenceFileCount: 1 });
  await expect(extractFromFileList([files[0], files[0]])).rejects.toMatchObject({ code: 'UNREADABLE_FILE' });
});
