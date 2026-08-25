/// <reference lib="webworker" />
import { extractFromZip } from '../lib/analyzer/ingestion';
import { analyzeRepositoryV2 } from '../lib/analyzer/v2/pipeline';

/**
 * Transient deep-analysis worker for private repositories.
 *
 * The main thread streams a bounded archive from /api/v2/github/private-archive
 * and transfers the buffer here. Parsing and graph construction happen entirely
 * inside this worker so the UI thread stays responsive. The buffer and the
 * resulting graph live only in this tab's memory: nothing is persisted, and the
 * main thread drops its copy of the archive as soon as transfer completes.
 */

export interface DeepScanRequest {
  type: 'analyze';
  buffer: ArrayBuffer;
  name: string;
  source?: string;
}

export type DeepScanResponse =
  | { type: 'progress'; stage: string; message: string; percent?: number }
  | { type: 'complete'; project: unknown }
  | { type: 'error'; code: string; message: string };

self.onmessage = async (event: MessageEvent<DeepScanRequest>) => {
  if (event.data?.type !== 'analyze') return;
  const { buffer, name } = event.data;
  const post = (msg: DeepScanResponse) => (self as unknown as Worker).postMessage(msg);

  try {
    post({ type: 'progress', stage: 'inventory', message: 'Inventorying repository files…', percent: 5 });

    const discovery = await extractFromZip(buffer, name);
    // Release the caller's reference promptly; extraction owns decoded copies.
    // Note: the transferred ArrayBuffer cannot be "untransferred", but we avoid
    // holding any additional references beyond this point.

    post({
      type: 'progress',
      stage: 'parse',
      message: `Parsing ${discovery.inventory.firstPartySourceFileCount} source files…`,
      percent: 20,
    });

    const project = await analyzeRepositoryV2(
      { ...discovery, source: event.data.source ?? `private:${name}` },
      {}
    );

    post({ type: 'progress', stage: 'complete', message: 'Graph ready', percent: 100 });
    post({ type: 'complete', project });
    // Allow the worker to be terminated by the main thread after completion.
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'ANALYSIS_FAILED';
    const message = err instanceof Error ? err.message : 'Private analysis failed.';
    post({ type: 'error', code, message });
  }
};
