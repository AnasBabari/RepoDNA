import { describe, expect, it } from 'vitest';

import {
  createBrowserArtifactKey,
  createBrowserExportId,
  hashCacheKey,
} from '../../../app/lib/export/browser-export-cache';
import { buildGraphExportViaWorker } from '../../../app/lib/export/graph/worker-client';
import { makeV2Fixture } from './fixtures';

describe('graph export worker client', () => {
  it('falls back to the main thread outside a browser and preserves progress metadata', async () => {
    const progress: Array<{ stage: string; percent: number }> = [];
    const file = await buildGraphExportViaWorker(
      makeV2Fixture(),
      'graph-json',
      (stage, percent) => progress.push({ stage, percent })
    );

    expect(file.format).toBe('graph-json');
    expect(file.byteSize).toBeGreaterThan(100);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(progress[0]).toEqual({ stage: 'normalizing', percent: 10 });
    expect(progress.at(-1)).toEqual({ stage: 'complete', percent: 100 });
  });

  it('rejects a pre-cancelled export with AbortError', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildGraphExportViaWorker(makeV2Fixture(), 'csv', undefined, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('browser export cache identities', () => {
  it('uses deterministic SHA-256 artifact keys without exposing repository text', async () => {
    const first = await createBrowserArtifactKey('github-private', 'source-digest-123');
    const second = await createBrowserArtifactKey('github-private', 'source-digest-123');
    const different = await createBrowserArtifactKey('local-folder', 'source-digest-123');

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('github-private');
    expect(await hashCacheKey('owner/private-repository')).not.toContain('private-repository');
  });

  it('names cached formats by artifact key and export schema', () => {
    expect(createBrowserExportId('abc123', 'cypher')).toBe('abc123:1.0.0:cypher');
  });
});
