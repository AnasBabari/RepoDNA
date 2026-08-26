/// <reference lib="webworker" />
import { extractFromZip } from '../lib/analyzer/ingestion';
import type { DiscoveredFile, IngestionInventory, IngestionLimits } from '../lib/analyzer/types';
import { analyzeRepositoryV2 } from '../lib/analyzer/v2/pipeline';

/**
 * Transient deep-analysis worker for private repositories.
 *
 * The main thread streams a bounded archive or a filtered Git tree payload here.
 * Parsing and graph construction happen entirely inside this worker so the UI
 * thread stays responsive. The source and resulting graph live only in this
 * tab's memory: nothing is persisted.
 */

export interface DeepScanDiscovery {
  files: DiscoveredFile[];
  skipped: { path: string; reason: string }[];
  name: string;
  source: string;
  inventory?: IngestionInventory;
}

export type DeepScanRequest =
  | {
      type: 'analyze';
      buffer: ArrayBuffer;
      name: string;
      source?: string;
      ingestionLimits?: IngestionLimits;
    }
  | {
      type: 'analyze-discovery';
      discovery: DeepScanDiscovery;
      name: string;
      source: string;
      ingestionLimits?: IngestionLimits;
    };

export type DeepScanResponse =
  | { type: 'progress'; stage: string; message: string; percent?: number }
  | { type: 'complete'; project: unknown }
  | { type: 'error'; code: string; message: string };

self.onmessage = async (event: MessageEvent<DeepScanRequest>) => {
  if (event.data?.type !== 'analyze' && event.data?.type !== 'analyze-discovery') return;
  const { name } = event.data;
  const post = (msg: DeepScanResponse) => (self as unknown as Worker).postMessage(msg);

  try {
    post({ type: 'progress', stage: 'inventory', message: 'Inventorying repository files…', percent: 5 });

    const discovery = event.data.type === 'analyze'
      ? await extractFromZip(event.data.buffer, name, event.data.ingestionLimits)
      : event.data.discovery;

    post({
      type: 'progress',
      stage: 'parse',
      message: `Parsing ${discovery.inventory?.firstPartySourceFileCount ?? discovery.files.length} source files…`,
      percent: 20,
    });

    const project = await analyzeRepositoryV2(
      { ...discovery, source: event.data.source ?? `private:${name}` },
      {
        ingestionLimits: event.data.ingestionLimits,
        onProgress: (progress) => {
          const ranges: Record<string, [number, number]> = {
            parse: [22, 58],
            resolve_relationships: [59, 78],
            analytics: [79, 94],
          };
          const [start, end] = ranges[progress.stage] ?? [20, 94];
          const ratio = progress.total > 0 ? Math.min(1, Math.max(0, progress.completed / progress.total)) : 1;
          post({
            type: 'progress',
            stage: progress.stage,
            message: progress.message,
            percent: Math.round(start + (end - start) * ratio),
          });
        },
      }
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
