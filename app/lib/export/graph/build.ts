import { normalizeArtifactForExport, type AnyExportableArtifact } from './normalize';
import { buildCsvBundle } from './csv';
import { buildCypher } from './cypher';
import { buildGraphJson } from './json';
import { GraphExportError, type GraphExportFile, type GraphExportFormat } from './types';

export type BuildProgressStage = 'normalizing' | 'validating' | 'serializing' | 'packaging' | 'hashing' | 'complete';
export type BuildProgressCallback = (stage: BuildProgressStage, percent: number) => void;

export async function buildGraphExportFile(
  artifact: AnyExportableArtifact,
  format: GraphExportFormat,
  onProgress?: BuildProgressCallback
): Promise<GraphExportFile> {
  if (format === 'parquet' && process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT !== 'true') {
    throw new GraphExportError('PARQUET_EXPORT_DISABLED', 'Parquet export is not enabled.');
  }
  onProgress?.('normalizing', 10);
  const normalized = await normalizeArtifactForExport(artifact);
  onProgress?.('validating', 30);
  onProgress?.('serializing', 50);
  if (format === 'csv' || format === 'parquet') onProgress?.('packaging', 70);
  let file: GraphExportFile;
  if (format === 'graph-json') file = await buildGraphJson(normalized.document);
  else if (format === 'csv') file = await buildCsvBundle(normalized.document);
  else if (format === 'cypher') file = await buildCypher(normalized.document);
  else if (format === 'parquet') {
    const { buildParquetBundle } = await import('./parquet');
    file = await buildParquetBundle(normalized.document);
  } else {
    throw new GraphExportError('UNSUPPORTED_EXPORT_FORMAT', `Unsupported format: ${format}.`);
  }
  onProgress?.('hashing', 90);
  onProgress?.('complete', 100);
  return file;
}

export async function buildGraphExportDocument(artifact: AnyExportableArtifact) {
  const normalized = await normalizeArtifactForExport(artifact);
  return normalized.document;
}
