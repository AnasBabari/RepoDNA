import { GraphExportError } from './types';
import type { GraphExportDocumentV1, GraphExportFile } from './types';

export async function buildParquetBundle(document: GraphExportDocumentV1): Promise<GraphExportFile> {
  void document;
  throw new GraphExportError('PARQUET_EXPORT_DISABLED', 'Parquet export is not enabled.');
}
