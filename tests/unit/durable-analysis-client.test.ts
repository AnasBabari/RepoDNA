import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { analyzePublicRepositoryDurably } from '../../app/lib/durable-analysis-client';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout,
    clearTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('durable analysis client', () => {
  it('aborts the persistent progress stream after a terminal artifact arrives', async () => {
    const progressStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"seq":1,"status":"running","stage":"parse","percent":28,"message":"Parsing"}\n'));
        // Deliberately do not close: Workflow streams remain resumable after
        // the run completes and the client must cancel this reader explicitly.
      },
    });
    const artifact = {
      schemaVersion: '2.0.0',
      nodes: [],
      edges: [],
      unresolved: [],
      inventory: {},
      coverage: {},
      completeness: {},
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v2/analyses')) {
        return new Response(JSON.stringify({
          runId: 'wrun_test',
          statusEndpoint: '/api/v2/analyses/wrun_test',
          eventsEndpoint: '/api/v2/analyses/wrun_test/events',
          artifactEndpoint: '/api/v2/analyses/wrun_test/artifact',
        }), { status: 202 });
      }
      if (url.includes('/events?')) return new Response(progressStream, { status: 200 });
      if (url.endsWith('/wrun_test')) {
        return new Response(JSON.stringify({ status: 'completed', artifactEndpoint: '/artifact' }), { status: 200 });
      }
      return new Response(JSON.stringify(artifact), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const result = await analyzePublicRepositoryDurably({
      targetUrl: 'https://github.com/octocat/Hello-World',
      signal: controller.signal,
    });

    expect(result.schemaVersion).toBe('2.0.0');
    expect(fetchMock).toHaveBeenCalledWith(
      '/artifact',
      expect.objectContaining({ cache: 'no-store' })
    );
  });
});
