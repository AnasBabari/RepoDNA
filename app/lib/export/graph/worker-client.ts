import { buildGraphExportFile as buildOnMainThread } from './build';
import type { GraphExportFile, GraphExportFormat } from './types';

type ProgressCallback = (stage: string, percent: number) => void;

export interface ExportWorkerHandle {
  promise: Promise<GraphExportFile>;
  cancel: () => void;
}

function createWorker(): Worker | null {
  try {
    return new Worker(new URL('../../workers/graph-export.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

function exportAbortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Export cancelled.', 'AbortError');
  const error = new Error('Export cancelled.');
  error.name = 'AbortError';
  return error;
}

export function runGraphExportInWorker(
  artifact: unknown,
  format: GraphExportFormat,
  onProgress?: ProgressCallback
): ExportWorkerHandle {
  const worker = createWorker();
  if (!worker) {
    let cancelled = false;
    const promise = (async () => {
      if (cancelled) throw exportAbortError();
      const file = await buildOnMainThread(artifact as never, format, onProgress);
      if (cancelled) throw exportAbortError();
      return file;
    })();
    return { promise, cancel: () => { cancelled = true; } };
  }

  let settled = false;
  let rejectPromise: ((reason: unknown) => void) | null = null;
  const id = Math.random().toString(36).slice(2);
  const promise = new Promise<GraphExportFile>((resolve, reject) => {
    rejectPromise = reject;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id: string; type: string; stage?: string; percent?: number; file?: { filename: string; mediaType: string; byteSize: number; sha256: string; buffer: ArrayBuffer }; code?: string; message?: string; details?: string[] };
      if (data.id !== id) return;
      if ((data.type === 'start' || data.type === 'progress') && onProgress && typeof data.stage === 'string' && typeof data.percent === 'number') {
        onProgress(data.stage, data.percent);
      } else if (data.type === 'complete' && data.file) {
        const bytes = new Uint8Array(data.file.buffer);
        const completedFile = data.file;
        finish(() => {
          resolve({
            format,
            filename: completedFile.filename,
            mediaType: completedFile.mediaType,
            bytes,
            byteSize: completedFile.byteSize,
            sha256: completedFile.sha256,
          });
        });
      } else if (data.type === 'error') {
        const error = new Error(data.message ?? 'Export failed.') as Error & { code: string; details: string[] };
        error.code = data.code ?? 'EXPORT_GENERATION_FAILED';
        error.details = data.details ?? [];
        finish(() => reject(error));
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'Worker error.')));
    };
    worker.postMessage({ id, artifact, format });
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectPromise?.(exportAbortError());
    },
  };
}

export async function buildGraphExportViaWorker(
  artifact: unknown,
  format: GraphExportFormat,
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<GraphExportFile> {
  const handle = runGraphExportInWorker(artifact, format, onProgress);
  const abort = () => handle.cancel();
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    return await handle.promise;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
