import type { RepoDNAProjectV2 } from './analyzer/v2/types';

const STORAGE_KEY = 'repodna:durable-analysis:v1';

export interface DurableRunReference {
  version: 1;
  runId: string;
  targetUrl: string;
  statusEndpoint: string;
  eventsEndpoint: string;
  artifactEndpoint: string;
  nextEventIndex: number;
}

export interface DurableProgressEvent {
  seq: number;
  status: 'running' | 'completed' | 'failed';
  stage: string;
  percent: number;
  message: string;
  code?: string;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    fallbackAvailable?: boolean;
    retryAfter?: number;
  };
}

interface StartedRun {
  runId: string;
  statusEndpoint: string;
  eventsEndpoint: string;
  artifactEndpoint: string;
}

interface RunStatusResponse {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  artifactEndpoint?: string;
  error?: { code?: string; message?: string } | null;
}

export class DurableAnalysisUnavailableError extends Error {
  code: string;
  fallbackAvailable: boolean;
  retryAfter?: number;

  constructor(message: string, options?: { code?: string; fallbackAvailable?: boolean; retryAfter?: number }) {
    super(message);
    this.name = 'DurableAnalysisUnavailableError';
    this.code = options?.code ?? 'DURABLE_ANALYSIS_UNAVAILABLE';
    this.fallbackAvailable = options?.fallbackAvailable ?? false;
    this.retryAfter = options?.retryAfter;
  }
}

export function isRepoDNAProjectV2(value: unknown): value is RepoDNAProjectV2 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RepoDNAProjectV2>;
  return (
    candidate.schemaVersion === '2.0.0' &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    Array.isArray(candidate.unresolved) &&
    Boolean(candidate.inventory) &&
    Boolean(candidate.coverage) &&
    Boolean(candidate.completeness)
  );
}

function saveRun(run: DurableRunReference): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
}

export function readPendingDurableRun(): DurableRunReference | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<DurableRunReference> | null;
    if (
      value?.version === 1 &&
      typeof value.runId === 'string' &&
      typeof value.targetUrl === 'string' &&
      typeof value.statusEndpoint === 'string' &&
      typeof value.eventsEndpoint === 'string' &&
      typeof value.artifactEndpoint === 'string'
    ) {
      return { ...value, nextEventIndex: Number.isSafeInteger(value.nextEventIndex) ? value.nextEventIndex! : 0 } as DurableRunReference;
    }
  } catch {
    // Corrupt or stale local state is discarded below.
  }
  window.localStorage.removeItem(STORAGE_KEY);
  return null;
}

export function clearPendingDurableRun(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

async function consumeProgress(
  run: DurableRunReference,
  signal: AbortSignal,
  onProgress?: (event: DurableProgressEvent) => void
): Promise<void> {
  const response = await fetch(`${run.eventsEndpoint}?startIndex=${run.nextEventIndex}`, {
    signal,
    cache: 'no-store',
  });
  if (!response.ok || !response.body) return;

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as DurableProgressEvent;
          onProgress?.(event);
          run.nextEventIndex += 1;
          saveRun(run);
        } catch {
          // A malformed progress line never invalidates the analysis artifact.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function awaitArtifact(
  run: DurableRunReference,
  signal: AbortSignal
): Promise<RepoDNAProjectV2> {
  while (true) {
    const response = await fetch(run.statusEndpoint, { signal, cache: 'no-store' });
    const body = (await response.json().catch(() => null)) as RunStatusResponse | ApiErrorBody | null;
    if (!response.ok) {
      const apiError = (body as ApiErrorBody | null)?.error;
      throw new DurableAnalysisUnavailableError(apiError?.message ?? 'Could not reconnect to the analysis run.', {
        code: apiError?.code,
        fallbackAvailable: apiError?.fallbackAvailable,
        retryAfter: apiError?.retryAfter,
      });
    }

    const status = body as RunStatusResponse;
    if (status.status === 'completed') {
      const artifactResponse = await fetch(status.artifactEndpoint ?? run.artifactEndpoint, {
        signal,
        cache: 'no-store',
      });
      const artifact = (await artifactResponse.json().catch(() => null)) as unknown;
      if (!artifactResponse.ok || !isRepoDNAProjectV2(artifact)) {
        throw new DurableAnalysisUnavailableError('The durable run completed without a valid RepoDNA v2 artifact.', {
          code: 'INVALID_ANALYSIS_ARTIFACT',
        });
      }
      return artifact;
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new DurableAnalysisUnavailableError(
        status.error?.message ?? `The durable analysis ${status.status}.`,
        { code: status.error?.code ?? `WORKFLOW_${status.status.toUpperCase()}` }
      );
    }
    await abortableDelay(900, signal);
  }
}

async function startRun(targetUrl: string, signal: AbortSignal): Promise<DurableRunReference> {
  const response = await fetch('/api/v2/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: targetUrl }),
    signal,
  });
  const body = (await response.json().catch(() => null)) as (StartedRun & ApiErrorBody) | null;
  if (!response.ok || !body?.runId) {
    throw new DurableAnalysisUnavailableError(body?.error?.message ?? 'Could not start durable deep analysis.', {
      code: body?.error?.code,
      fallbackAvailable: body?.error?.fallbackAvailable,
      retryAfter: body?.error?.retryAfter,
    });
  }

  return {
    version: 1,
    runId: body.runId,
    targetUrl,
    statusEndpoint: body.statusEndpoint,
    eventsEndpoint: body.eventsEndpoint,
    artifactEndpoint: body.artifactEndpoint,
    nextEventIndex: 0,
  };
}

export async function analyzePublicRepositoryDurably(options: {
  targetUrl: string;
  signal: AbortSignal;
  resume?: DurableRunReference | null;
  onRun?: (run: DurableRunReference) => void;
  onProgress?: (event: DurableProgressEvent) => void;
}): Promise<RepoDNAProjectV2> {
  const run = options.resume ?? await startRun(options.targetUrl, options.signal);
  saveRun(run);
  options.onRun?.(run);

  const progress = consumeProgress(run, options.signal, options.onProgress).catch((error: unknown) => {
    if (options.signal.aborted) throw error;
    // Status polling remains authoritative if the optional live stream drops.
  });

  try {
    const artifact = await awaitArtifact(run, options.signal);
    await progress;
    clearPendingDurableRun();
    return artifact;
  } catch (error) {
    await progress.catch(() => undefined);
    if (!options.signal.aborted) clearPendingDurableRun();
    throw error;
  }
}
