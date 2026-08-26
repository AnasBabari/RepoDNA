import { GraphExportError } from './types';
import type { GraphExportDocumentV1, GraphExportFile } from './types';

export async function buildParquetBundle(_document: GraphExportDocumentV1): Promise<GraphExportFile> {
  throw new GraphExportError('PARQUET_EXPORT_DISABLED', 'Parquet export is not enabled.');
}
