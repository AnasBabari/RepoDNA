import { describe, expect, it } from 'vitest';

import { analyzeRepositoryFiles, type AnalyzeProgress } from '../../app/lib/analyzer';
import { analyzeRepositoryV2 } from '../../app/lib/analyzer/v2/pipeline';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

function discovered(path: string, content: string): DiscoveredFile {
  return { path, content, size: content.length, hash: `${path}-hash` };
}

describe('bounded analysis progress', () => {
  it('reports parse and relationship checkpoints while preserving the result', async () => {
    const progress: AnalyzeProgress[] = [];
    const project = await analyzeRepositoryFiles(
      {
        name: 'progress-fixture',
        source: 'test:progress-fixture',
        skipped: [],
        files: [
          discovered('src/server.js', "const router = require('./routes');\nrouter.get('/health', health)"),
          discovered('src/routes.js', 'function health(req, res) { res.send(\'ok\'); }'),
        ],
      },
      {
        parserMode: 'legacy',
        progressEvery: 1,
        onProgress: (event) => progress.push(event),
      }
    );

    expect(project.repository.fileCount).toBe(2);
    expect(progress.some((event) => event.stage === 'parse' && event.completed === 2)).toBe(true);
    expect(progress.some((event) => event.stage === 'resolve_relationships' && event.completed === 4)).toBe(true);
    expect(progress[0]).toMatchObject({ stage: 'parse', completed: 0, total: 2 });
  });

  it('marks a soft file-limit scan as incomplete and calculates coverage against the full inventory', async () => {
    const project = await analyzeRepositoryV2(
      {
        name: 'partial-fixture',
        source: 'test:partial-fixture',
        skipped: [{ path: 'src/omitted.py', reason: 'max_files_limit' }],
        files: [discovered('src/main.py', 'def main():\n    return 1')],
        inventory: {
          totalFileCount: 2,
          totalBytes: 40,
          firstPartySourceFileCount: 2,
          candidateFileCount: 2,
          ignoredFileCount: 0,
          generatedFileCount: 0,
          unsupportedSourceFileCount: 0,
          totalArchiveEntries: 2,
          skippedByReason: { max_files_limit: 1 },
          acquisitionMode: 'git-tree',
          repositorySizeKb: 75_000,
          truncation: {
            hitLimits: ['TOO_MANY_FILES'],
            maxFilesReached: true,
            maxBytesReached: false,
          },
        },
      },
      { parserMode: 'legacy' }
    );

    expect(project.coverage.percentage).toBe(50);
    expect(project.completeness.status).toBe('COVERAGE_LIMITED');
    expect(project.security.truncated).toContain('TOO_MANY_FILES');
    expect(project.inventory.acquisitionMode).toBe('git-tree');
  });

  it('reports the parser mode actually used by the V2 pipeline', async () => {
    const project = await analyzeRepositoryV2(
      {
        name: 'legacy-parser-fixture',
        source: 'test:legacy-parser-fixture',
        skipped: [],
        files: [discovered('src/main.py', 'def main():\n    return 1')],
      },
      { parserMode: 'legacy' }
    );

    expect(project.parsers.mode).toBe('legacy');
  });
});
