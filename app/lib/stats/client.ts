export type RepositoryStats = { scannedRepositories: number; updatedAt: string };

function isRepositoryStats(value: unknown): value is RepositoryStats {
  if (typeof value !== 'object' || value === null) return false;
  const stats = value as Partial<RepositoryStats>;
  return typeof stats.scannedRepositories === 'number'
    && Number.isSafeInteger(stats.scannedRepositories)
    && stats.scannedRepositories >= 0
    && typeof stats.updatedAt === 'string';
}

/** A single in-flight refresh shared by polling, focus and visibility events. */
export function createRepositoryStatsRefresher(
  onSuccess: (stats: RepositoryStats) => void,
  onUnavailable: () => void,
) {
  let disposed = false;
  let controller: AbortController | null = null;
  let pending: Promise<void> | null = null;

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const request = new AbortController();
    controller = request;
    // Start in a microtask so even synchronous fetch failures release pending.
    pending = Promise.resolve().then(async () => {
      if (disposed) return;
      try {
        const response = await fetch('/api/stats', {
          method: 'GET', cache: 'no-store', signal: request.signal,
          headers: { Accept: 'application/json' },
        });
        const data: unknown = await response.json();
        if (disposed || request.signal.aborted) return;
        if (response.ok && isRepositoryStats(data)) onSuccess(data);
        else onUnavailable();
      } catch (error) {
        // Cancellation is normal during unmount, including body-read rejection.
        if (disposed || request.signal.aborted
          || (error instanceof Error && error.name === 'AbortError')) return;
        onUnavailable();
      }
    }).finally(() => {
      if (controller === request) {
        controller = null;
        pending = null;
      }
    });
    return pending;
  }

  function dispose() {
    disposed = true;
    controller?.abort(new DOMException('Scan counter unmounted', 'AbortError'));
    controller = null;
  }

  return { refresh, dispose };
}
