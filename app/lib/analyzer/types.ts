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

export interface IngestionInventory {
  totalFileCount: number;
  totalBytes: number;
  firstPartySourceFileCount: number;
  candidateFileCount: number;
  ignoredFileCount: number;
  generatedFileCount: number;
  unsupportedSourceFileCount: number;
  totalArchiveEntries: number;
  skippedByReason: Record<string, number>;
  /** How the source was acquired; tree mode avoids a single large ZIP payload. */
  acquisitionMode?: 'archive' | 'git-tree';
  /** GitHub's repository size hint, in KB, when tree mode was selected. */
  repositorySizeKb?: number;
  /** Limits that produced a truthful partial inventory rather than a hard failure. */
  truncation?: {
    hitLimits: string[];
    maxFilesReached: boolean;
    maxBytesReached: boolean;
  };
}

export interface IngestionLimits {
  maxFiles: number;
  maxArchiveEntries: number;
  maxFileBytes: number;
  maxArchiveBytes: number;
  maxTotalExtractedBytes: number;
  fetchTimeoutMs: number;
  /** Skip codeload for repositories whose GitHub size hint is above this value. */
  treeFirstSizeKb?: number;
  /** Keep a bounded partial inventory when candidate files exceed maxFiles. */
  allowPartialOnFileLimit?: boolean;
}

export const DEFAULT_INGESTION_LIMITS: IngestionLimits = {
  maxFiles: 10_000,
  maxArchiveEntries: 20_000,
  maxFileBytes: 1_000_000, // 1 MB
  maxArchiveBytes: 25 * 1024 * 1024, // 25 MB
  maxTotalExtractedBytes: 100 * 1024 * 1024, // 100 MB
  fetchTimeoutMs: 20_000, // 20 seconds
};

/**
 * Public analyses run inside a durable workflow, so they do not need to send
 * the downloaded archive back through a browser/serverless response. Keep the
 * normal 25 MB browser/private bound, but allow a larger bounded codeload
 * archive for public repositories before falling back to Git-tree acquisition.
 */
export const PUBLIC_REPOSITORY_INGESTION_LIMITS: IngestionLimits = {
  ...DEFAULT_INGESTION_LIMITS,
  // Public analyses run in the durable workflow and can use Git-tree
  // acquisition, so a large repository is not rejected just because its
  // generated ZIP is larger than the browser/private 25 MB bound.
  maxFiles: 20_000,
  maxArchiveEntries: 100_000,
  maxArchiveBytes: 128 * 1024 * 1024,
  maxTotalExtractedBytes: 192 * 1024 * 1024,
  fetchTimeoutMs: 60_000,
  treeFirstSizeKb: 50_000,
  allowPartialOnFileLimit: true,
};

export type IngestionErrorCode =
  | 'INVALID_GITHUB_URL'
  | 'REPO_NOT_FOUND'
  | 'UPSTREAM_GITHUB_ERROR'
  | 'UPSTREAM_GITHUB_RATE_LIMITED'
  | 'GITHUB_TOKEN_EXPIRED'
  | 'GITHUB_FORBIDDEN'
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
