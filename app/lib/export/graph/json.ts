import { stableStringify, sha256Hex, utf8Bytes } from './stable-json';
import { graphExportFilename } from './index';
import { GRAPH_EXPORT_MEDIA_TYPES } from './types';
import type { GraphExportDocumentV1, GraphExportFile } from './types';
import { assertExportableDocument } from './validate';

export async function buildGraphJson(document: GraphExportDocumentV1): Promise<GraphExportFile> {
  assertExportableDocument(document);
  const text = stableStringify(document, 2);
  const bytes = utf8Bytes(text);
  const sha256 = await sha256Hex(bytes);
  return {
    format: 'graph-json',
    filename: graphExportFilename(document.manifest, 'graph-json'),
    mediaType: GRAPH_EXPORT_MEDIA_TYPES['graph-json'],
    bytes,
    byteSize: bytes.byteLength,
    sha256,
  };
}
