import type { DiscoveredFile, IngestionInventory } from './analyzer/types';

/**
 * Browser deep-scan client for private repositories.
 *
 * The GitHub token never reaches page JavaScript. Small repositories use the
 * bounded ZIP endpoint; oversized repositories use the server-side Git tree
 * endpoint, which returns only filtered source/configuration files. Both paths
 * hand analysis to a transient worker and persist nothing.
 */

export type DeepScanAuthState =
  | 'ok'
  | 'unauthenticated'
  | 'expired'
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable';

export interface DeepScanResult {
  project: unknown;
  authState: Extract<DeepScanAuthState, 'ok'>;
}

export interface DeepScanFailure {
  authState: Exclude<DeepScanAuthState, 'ok'>;
  code: string;
  message: string;
  installSettingsUrl?: string;
}

export type DeepScanOutcome = DeepScanResult | DeepScanFailure;

export function isDeepScanFailure(outcome: DeepScanOutcome): outcome is DeepScanFailure {
  return !(outcome as DeepScanResult).project;
}

interface WorkerProgress {
  stage: string;
  message: string;
  percent?: number;
}

interface DiscoveryPayload {
  files: DiscoveredFile[];
  skipped: { path: string; reason: string }[];
  name: string;
  source: string;
  inventory?: IngestionInventory;
}

type WorkerRequest =
  | { type: 'analyze'; buffer: ArrayBuffer; name: string; source?: string }
  | { type: 'analyze-discovery'; discovery: DiscoveryPayload; name: string; source: string };

async function runWorkerRequest(
  request: WorkerRequest,
  onProgress?: (p: WorkerProgress) => void,
  signal?: AbortSignal
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/deep-analysis.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(Object.assign(err instanceof Error ? err : new Error('worker_unavailable'), { code: 'WORKER_UNAVAILABLE' }));
      return;
    }

    const abort = () => {
      worker.terminate();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'progress'; stage: string; message: string; percent?: number }
        | { type: 'complete'; project: unknown }
        | { type: 'error'; code: string; message: string };
      if (data.type === 'progress') {
        onProgress?.(data);
      } else if (data.type === 'complete') {
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        resolve(data.project);
      } else {
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        reject(Object.assign(new Error(data.message), { code: data.code }));
      }
    };

    worker.onerror = (event) => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(
        Object.assign(new Error(event.message || 'Worker crashed'), { code: 'WORKER_ERROR' })
      );
    };

    // Transfer ZIP ownership zero-copy; tree discovery is structured-cloned
    // because it is already a filtered set of bounded source strings.
    const transfer: Transferable[] = request.type === 'analyze' ? [request.buffer] : [];
    worker.postMessage(request, transfer);
  });
}

async function runWorkerScan(
  buffer: ArrayBuffer,
  name: string,
  onProgress?: (p: WorkerProgress) => void,
  signal?: AbortSignal
): Promise<unknown> {
  return runWorkerRequest({ type: 'analyze', buffer, name }, onProgress, signal);
}

async function runWorkerDiscoveryScan(
  discovery: DiscoveryPayload,
  name: string,
  onProgress?: (p: WorkerProgress) => void,
  signal?: AbortSignal
): Promise<unknown> {
  return runWorkerRequest(
    { type: 'analyze-discovery', discovery, name, source: discovery.source },
    onProgress,
    signal
  );
}

/** Inline fallback used only where Workers cannot start (very old browsers). */
async function runInlineScan(buffer: ArrayBuffer, name: string): Promise<unknown> {
  const [{ extractFromZip }, { analyzeRepositoryV2 }] = await Promise.all([
    import('./analyzer/ingestion'),
    import('./analyzer/v2/pipeline'),
  ]);
  const discovery = await extractFromZip(buffer, name);
  return analyzeRepositoryV2({ ...discovery, source: `private:${name}` }, {});
}

async function runInlineDiscoveryScan(discovery: DiscoveryPayload): Promise<unknown> {
  const { analyzeRepositoryV2 } = await import('./analyzer/v2/pipeline');
  return analyzeRepositoryV2(discovery, {});
}

function mapArchiveFailure(status: number, body: { code?: string; message?: string }): DeepScanFailure {
  switch (status) {
    case 401:
      return {
        authState: body.code === 'GITHUB_TOKEN_EXPIRED' ? 'expired' : 'unauthenticated',
        code: body.code ?? 'GITHUB_AUTH_REQUIRED',
        message: body.message ?? 'GitHub authentication required.',
      };
    case 403:
      return {
        authState: 'forbidden',
        code: body.code ?? 'GITHUB_FORBIDDEN',
        message: body.message ?? 'RepoDNA does not have access to this repository.',
        installSettingsUrl: (body as { installSettingsUrl?: string }).installSettingsUrl,
      };
    case 429:
      return {
        authState: 'rate_limited',
        code: body.code ?? 'RATE_LIMITED',
        message: body.message ?? 'Rate limit reached. Please retry shortly.',
      };
    default:
      return {
        authState: 'unavailable',
        code: body.code ?? 'ARCHIVE_FETCH_FAILED',
        message: body.message ?? 'Repository archive could not be fetched.',
      };
  }
}

export async function analyzePrivateRepositoryInBrowser(options: {
  url: string;
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
}): Promise<DeepScanOutcome> {
  const { url, onProgress, signal } = options;

  onProgress?.({ stage: 'download', message: 'Fetching private repository source…', percent: 2 });

  let res: Response;
  try {
    res = await fetch('/api/v2/github/private-archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return {
      authState: 'unavailable',
      code: 'NETWORK_ERROR',
      message: 'Could not reach the private archive service.',
    };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (body?.code === 'ARCHIVE_TOO_LARGE') {
      return analyzePrivateRepositoryViaTree({ url, onProgress, signal });
    }
    return mapArchiveFailure(res.status, body ?? {});
  }

  onProgress?.({ stage: 'download', message: 'Archive received — handing off to local analysis…', percent: 4 });

  const rawBuffer = await res.arrayBuffer();

  try {
    const supportsWorkers = typeof Worker !== 'undefined';
    const project = supportsWorkers
      ? await runWorkerScan(rawBuffer, url.split('/').pop() ?? 'repository', onProgress, signal)
      : await runInlineScan(rawBuffer, url.split('/').pop() ?? 'repository');
    return { project, authState: 'ok' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    const code = (err as { code?: string }).code ?? 'ANALYSIS_FAILED';
    // A worker crash should not lose the scan if inline execution can still run.
    if ((code === 'WORKER_UNAVAILABLE' || code === 'WORKER_ERROR') && typeof Worker !== 'undefined') {
      try {
        const project = await runInlineScan(rawBuffer, url.split('/').pop() ?? 'repository');
        return { project, authState: 'ok' };
      } catch (inlineErr) {
        return {
          authState: 'unavailable',
          code: (inlineErr as { code?: string }).code ?? 'ANALYSIS_FAILED',
          message: inlineErr instanceof Error ? inlineErr.message : 'Private analysis failed.',
        };
      }
    }
    return {
      authState: 'unavailable',
      code,
      message: err instanceof Error ? err.message : 'Private analysis failed.',
    };
  }
}

async function analyzePrivateRepositoryViaTree(options: {
  url: string;
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
}): Promise<DeepScanOutcome> {
  const { url, onProgress, signal } = options;
  onProgress?.({ stage: 'download', message: 'ZIP is over 25 MB — fetching the repository Git tree instead…', percent: 2 });

  let res: Response;
  try {
    res = await fetch('/api/v2/github/private-tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return {
      authState: 'unavailable',
      code: 'NETWORK_ERROR',
      message: 'Could not reach the private repository source service.',
    };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    return mapArchiveFailure(res.status, body ?? {});
  }

  let discovery: DiscoveryPayload;
  try {
    discovery = (await res.json()) as DiscoveryPayload;
    if (!discovery || !Array.isArray(discovery.files) || typeof discovery.name !== 'string') {
      return {
        authState: 'unavailable',
        code: 'INVALID_DISCOVERY',
        message: 'GitHub returned an invalid repository source payload.',
      };
    }
  } catch {
    return {
      authState: 'unavailable',
      code: 'INVALID_DISCOVERY',
      message: 'GitHub returned an unreadable repository source payload.',
    };
  }

  onProgress?.({
    stage: 'inventory',
    message: `Git tree ready — analyzing ${discovery.inventory?.firstPartySourceFileCount ?? discovery.files.length} source files…`,
    percent: 8,
  });

  try {
    const supportsWorkers = typeof Worker !== 'undefined';
    const project = supportsWorkers
      ? await runWorkerDiscoveryScan(discovery, discovery.name, onProgress, signal)
      : await runInlineDiscoveryScan(discovery);
    return { project, authState: 'ok' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    const code = (err as { code?: string }).code ?? 'ANALYSIS_FAILED';
    if (code === 'WORKER_UNAVAILABLE' || code === 'WORKER_ERROR') {
      try {
        const project = await runInlineDiscoveryScan(discovery);
        return { project, authState: 'ok' };
      } catch (inlineErr) {
        return {
          authState: 'unavailable',
          code: (inlineErr as { code?: string }).code ?? 'ANALYSIS_FAILED',
          message: inlineErr instanceof Error ? inlineErr.message : 'Private tree analysis failed.',
        };
      }
    }
    return {
      authState: 'unavailable',
      code,
      message: err instanceof Error ? err.message : 'Private tree analysis failed.',
    };
  }
}
