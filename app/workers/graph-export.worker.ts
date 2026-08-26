import { buildGraphExportFile } from '../lib/export/graph/build';
import type { GraphExportFormat } from '../lib/export/graph/types';

type WorkerRequest = {
  id: string;
  artifact: unknown;
  format: GraphExportFormat;
};

type WorkerResponse =
  | { id: string; type: 'start'; stage: string; percent: number }
  | { id: string; type: 'progress'; stage: string; percent: number }
  | { id: string; type: 'complete'; file: { filename: string; mediaType: string; byteSize: number; sha256: string; buffer: ArrayBuffer } }
  | { id: string; type: 'error'; code: string; message: string; details: string[] };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, artifact, format } = event.data as WorkerRequest;
  const post = (message: WorkerResponse, transfer?: Transferable[]) => {
    (self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void }).postMessage(message, transfer ?? []);
  };
  try {
    post({ id, type: 'start', stage: 'normalizing', percent: 0 });
    const file = await buildGraphExportFile(artifact as never, format, (stage, percent) => {
      post({ id, type: 'progress', stage, percent });
    });
    const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    post(
      {
        id,
        type: 'complete',
        file: { filename: file.filename, mediaType: file.mediaType, byteSize: file.byteSize, sha256: file.sha256, buffer },
      },
      [buffer]
    );
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'EXPORT_GENERATION_FAILED';
    const message = error instanceof Error ? error.message : 'Export failed.';
    const details = (error as { details?: string[] }).details ?? [];
    post({ id, type: 'error', code, message, details });
  }
};

export {};
