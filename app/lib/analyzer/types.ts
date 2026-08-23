import type {
  ArchitectureComponent,
  ArchitectureConnection,
  CallRecord,
  Diagnostic,
  EntrypointRecord,
  FileRecord,
  FlowRecord,
  ImportRecord,
  RepoDNAProject,
  RouteRecord,
  SymbolRecord,
  TechnologyBoundary,
} from '../types';

export interface IngestionLimits {
  maxFiles: number;
  maxArchiveEntries: number;
  maxFileBytes: number;
  maxArchiveBytes: number;
  maxTotalExtractedBytes: number;
  fetchTimeoutMs: number;
}

export const DEFAULT_INGESTION_LIMITS: IngestionLimits = {
  maxFiles: 10_000,
  maxArchiveEntries: 20_000,
  maxFileBytes: 1_000_000, // 1 MB
  maxArchiveBytes: 25 * 1024 * 1024, // 25 MB
  maxTotalExtractedBytes: 100 * 1024 * 1024, // 100 MB
  fetchTimeoutMs: 20_000, // 20 seconds
};

export type IngestionErrorCode =
  | 'INVALID_GITHUB_URL'
  | 'REPO_NOT_FOUND'
  | 'UPSTREAM_GITHUB_ERROR'
  | 'UPSTREAM_GITHUB_RATE_LIMITED'
  | 'FETCH_TIMEOUT'
  | 'ARCHIVE_TOO_LARGE'
  | 'EXTRACTED_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'TOO_MANY_ARCHIVE_ENTRIES'
  | 'SUSPICIOUS_COMPRESSION_RATIO'
  | 'PATH_TRAVERSAL'
  | 'INVALID_ARCHIVE'
  | 'UNREADABLE_FILE';

export class IngestionError extends Error {
  code: IngestionErrorCode;
  status: number;

  constructor(code: IngestionErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.status = status;
  }
}

export interface DiscoveredFile {
  path: string;
  size: number;
  content: string;
  hash: string;
}

export interface ExpressMountRecord {
  id: string;
  file: string;
  line: number;
  receiver: string;
  prefix: string | null;
  prefixExpression: string | null;
  targetIdentifier: string | null;
  targetModule: string | null;
  targetExpression: string;
  dynamic: boolean;
}

export interface PartialAnalysis {
  file: FileRecord;
  symbols: SymbolRecord[];
  imports: ImportRecord[];
  calls: CallRecord[];
  routes: RouteRecord[];
  frameworks: Set<string>;
  databases: Set<string>;
  externals: Set<string>;
  entrypointEvidence: string[];
  expressMounts?: ExpressMountRecord[];
  parseMeta?: { quality: 'complete' | 'partial' | 'failed'; errorNodes: number };
  parserNotice?: { code: string; message: string };
}

export type {
  ArchitectureComponent,
  ArchitectureConnection,
  CallRecord,
  Diagnostic,
  EntrypointRecord,
  FileRecord,
  FlowRecord,
  ImportRecord,
  RepoDNAProject,
  RouteRecord,
  SymbolRecord,
  TechnologyBoundary,
};
