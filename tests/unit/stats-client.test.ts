import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRepositoryStatsRefresher } from '../../app/lib/stats/client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const stats = { scannedRepositories: 42, updatedAt: '2026-10-16T17:00:00Z' };
afterEach(() => vi.unstubAllGlobals());

describe('scan-counter request lifecycle', () => {
  it('coalesces refresh bursts without cancelling the current request', async () => {
    const response = deferred<Response>();
    const fetcher = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetcher);
    const success = vi.fn(); const unavailable = vi.fn();
    const client = createRepositoryStatsRefresher(success, unavailable);
    const requests = Array.from({ length: 20 }, () => client.refresh());
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    response.resolve(Response.json(stats));
    await Promise.all(requests);
    expect(success).toHaveBeenCalledExactlyOnceWith(stats);
    expect(unavailable).not.toHaveBeenCalled();
    await client.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('handles fetch rejection on cleanup and never publishes after disposal', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    })));
    const success = vi.fn(); const unavailable = vi.fn();
    const client = createRepositoryStatsRefresher(success, unavailable);
    const request = client.refresh();
    await Promise.resolve();
    client.dispose();
    await expect(request).resolves.toBeUndefined();
    await client.refresh();
    expect(success).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores a body read that settles after cleanup (%s)', async (settlement) => {
    const body = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => body.promise }));
    const success = vi.fn(); const unavailable = vi.fn();
    const client = createRepositoryStatsRefresher(success, unavailable);
    const request = client.refresh();
    await Promise.resolve(); await Promise.resolve();
    client.dispose();
    if (settlement === 'resolve') body.resolve(stats);
    else body.reject(new DOMException('signal is aborted without reason', 'AbortError'));
    await expect(request).resolves.toBeUndefined();
    expect(success).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('can recover after a synchronous fetch failure', async () => {
    const fetcher = vi.fn().mockImplementationOnce(() => { throw new TypeError('offline'); })
      .mockResolvedValue(Response.json(stats));
    vi.stubGlobal('fetch', fetcher);
    const success = vi.fn(); const unavailable = vi.fn();
    const client = createRepositoryStatsRefresher(success, unavailable);
    await client.refresh();
    expect(unavailable).toHaveBeenCalledOnce();
    await client.refresh();
    expect(success).toHaveBeenCalledWith(stats);
  });

  it.each([null, { ...stats, scannedRepositories: -1 }, { ...stats, scannedRepositories: 1.5 }])(
    'rejects invalid counter data without inventing a number', async (data) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
      const success = vi.fn(); const unavailable = vi.fn();
      await createRepositoryStatsRefresher(success, unavailable).refresh();
      expect(success).not.toHaveBeenCalled();
      expect(unavailable).toHaveBeenCalledOnce();
    },
  );

  it('does not accept a count returned with an unsuccessful HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(stats, { status: 503 })));
    const success = vi.fn(); const unavailable = vi.fn();
    await createRepositoryStatsRefresher(success, unavailable).refresh();
    expect(success).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
  });
});
