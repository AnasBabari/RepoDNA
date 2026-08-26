import {
  GRAPH_EXPORT_EXTENSIONS,
  type GraphExportFormat,
  type GraphExportManifest,
} from './types';

export * from './types';
export * from './stable-json';
export * from './normalize';
export * from './validate';

const MAX_FILENAME_LENGTH = 120;

export function sanitizeFilenameSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return sanitized || 'repository';
}

export function exportShortIdentity(manifest: GraphExportManifest): string {
  const identity = manifest.repository.commitSha ?? manifest.sourceArtifactSha256;
  return sanitizeFilenameSegment(identity.slice(0, 7));
}

const FORMAT_SUFFIX: Record<GraphExportFormat, string> = {
  'graph-json': 'graph',
  csv: 'csv',
  cypher: 'cypher',
  parquet: 'parquet',
};

export function graphExportFilename(manifest: GraphExportManifest, format: GraphExportFormat): string {
  const identity = exportShortIdentity(manifest);
  const suffix = `-${identity}-repodna-${FORMAT_SUFFIX[format]}.${GRAPH_EXPORT_EXTENSIONS[format]}`;
  const available = Math.max(8, MAX_FILENAME_LENGTH - suffix.length);
  const repoSegment = sanitizeFilenameSegment(manifest.repository.name).slice(0, available);
  return `${repoSegment}${suffix}`;
}
