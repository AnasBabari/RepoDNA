import { NextRequest, NextResponse } from 'next/server';

import { createApiErrorResponse } from '../../../lib/api-error';
import { readCachedPublicArtifact } from '../../../lib/analyzer/v2/artifact-cache';
import { auth } from '../../../lib/auth';
import { normalizeArtifactForExport } from '../../../lib/export/graph/normalize';
import { buildCsvBundle } from '../../../lib/export/graph/csv';
import { buildCypher } from '../../../lib/export/graph/cypher';
import { buildGraphJson } from '../../../lib/export/graph/json';
import { graphExportFilename } from '../../../lib/export/graph';
import { isGraphExportFormat } from '../../../lib/export/graph/types';
import { checkExportRateLimit } from '../../../lib/export/export-rate-limit';
import { validateRepoDNAProjectV2 } from '../../../lib/schema/safe-validator';
import {
  createSignedDownloadUrl,
  isPublicExportCacheConfigured,
  publicExportBlobPath,
  readCachedPublicExport,
  storePublicExport,
} from '../../../lib/export/public-export-cache';

export const dynamic = 'force-dynamic';

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const OWNER_RE = /^[a-z0-9._-]+$/i;
const REPO_RE = /^[a-z0-9._-]+$/i;

function isValidExportRequest(body: unknown): body is {
  owner: string;
  repo: string;
  commitSha: string;
  format: string;
  exportSchemaVersion: string;
} {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  return (
    typeof record.owner === 'string' &&
    typeof record.repo === 'string' &&
    typeof record.commitSha === 'string' &&
    typeof record.format === 'string' &&
    typeof record.exportSchemaVersion === 'string'
  );
}

export async function POST(request: NextRequest) {
  let session: { user?: { id?: string } } | null = null;
  try {
    session = (await auth()) as unknown as typeof session;
  } catch {
    session = null;
  }

  const rawIp =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip')?.trim() ??
    '127.0.0.1';

  try {
    const userId = (session as unknown as { user?: { id?: string } } | null)?.user?.id ?? null;
    const rateLimit = await checkExportRateLimit({ ip: rawIp, userId });
    if (!rateLimit.allowed) {
      return createApiErrorResponse('RATE_LIMITED', 'Too many export requests.', 429, {
        retryAfter: rateLimit.retryAfter ?? 60,
      });
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'RATE_LIMIT_UNAVAILABLE') {
      return createApiErrorResponse('RATE_LIMIT_UNAVAILABLE', 'Rate-limit infrastructure unavailable.', 503, {
        fallbackAvailable: true,
      });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return createApiErrorResponse('INVALID_EXPORT_REQUEST', 'Body must be valid JSON.', 400);
  }

  if (!isValidExportRequest(body)) {
    return createApiErrorResponse('INVALID_EXPORT_REQUEST', 'Missing required export fields.', 400);
  }

  const allowedKeys = new Set(['owner', 'repo', 'commitSha', 'format', 'exportSchemaVersion']);
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      return createApiErrorResponse('INVALID_EXPORT_REQUEST', `Unexpected field: ${key}.`, 400);
    }
  }

  const { owner, repo, commitSha, format, exportSchemaVersion } = body as {
    owner: string;
    repo: string;
    commitSha: string;
    format: string;
    exportSchemaVersion: string;
  };

  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
    return createApiErrorResponse('INVALID_EXPORT_REQUEST', 'Invalid owner or repo.', 400);
  }
  if (!COMMIT_SHA_RE.test(commitSha)) {
    return createApiErrorResponse('INVALID_EXPORT_REQUEST', 'commitSha must be a 40-character lowercase hex string.', 400);
  }
  if (exportSchemaVersion !== '1.0.0') {
    return createApiErrorResponse('INVALID_EXPORT_REQUEST', 'Unsupported exportSchemaVersion.', 400);
  }
  if (!isGraphExportFormat(format)) {
    return createApiErrorResponse('UNSUPPORTED_EXPORT_FORMAT', `Unsupported format: ${format}.`, 400);
  }
  if (format === 'parquet' && process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT !== 'true') {
    return createApiErrorResponse('PARQUET_EXPORT_DISABLED', 'Parquet export is not enabled.', 400);
  }

  if (!isPublicExportCacheConfigured()) {
    return createApiErrorResponse('EXPORT_CACHE_UNAVAILABLE', 'Export cache is not configured.', 503, {
      fallbackAvailable: true,
    });
  }

  const cached = await readCachedPublicArtifact({ owner, repo, commitSha });
  if (!cached) {
    return createApiErrorResponse('ANALYSIS_ARTIFACT_NOT_FOUND', 'Canonical analysis artifact not found.', 404);
  }
  const artifactValidation = validateRepoDNAProjectV2(cached.project);
  if (!artifactValidation.valid) {
    return createApiErrorResponse('ANALYSIS_SCHEMA_ERROR', 'Cached analysis artifact failed schema validation.', 422);
  }

  let normalized;
  try {
    normalized = await normalizeArtifactForExport(cached.project);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Graph validation failed.';
    return createApiErrorResponse('EXPORT_GRAPH_INVALID', message, 422);
  }

  const sourceDigest = normalized.sourceDigest;
  const expiresEpoch = new Date(cached.pointer.expiresAt).getTime();
  if (!Number.isFinite(expiresEpoch) || expiresEpoch <= Date.now()) {
    return createApiErrorResponse('ANALYSIS_ARTIFACT_EXPIRED', 'Canonical artifact has expired.', 410);
  }

  const pathname = publicExportBlobPath({
    owner,
    repo,
    commitSha,
    sourceDigest,
    expiresEpoch,
    format,
  });

  const existing = await readCachedPublicExport(pathname);
  if (existing) {
    let signed;
    try {
      signed = await createSignedDownloadUrl(pathname);
    } catch {
      return createApiErrorResponse('EXPORT_DOWNLOAD_UNAVAILABLE', 'Could not issue a secure export download.', 503, {
        fallbackAvailable: true,
      });
    }
    const exportId = await sha256Hex(`${sourceDigest}:${format}:1.0.0`);
    const filename = filenameForFormat(normalized.document.manifest, format);
    return NextResponse.json({
      exportId,
      format,
      filename,
      mediaType: existing.metadata.mediaType,
      byteSize: existing.metadata.byteSize,
      sha256: existing.metadata.sha256,
      cache: { layer: 'vercel-blob', hit: true, expiresAt: cached.pointer.expiresAt },
      download: { url: signed.url, expiresAt: signed.expiresAt },
    });
  }

  let file;
  try {
    if (format === 'graph-json') file = await buildGraphJson(normalized.document);
    else if (format === 'csv') file = await buildCsvBundle(normalized.document);
    else if (format === 'cypher') file = await buildCypher(normalized.document);
    else if (format === 'parquet') {
      const { buildParquetBundle } = await import('../../../lib/export/graph/parquet');
      file = await buildParquetBundle(normalized.document);
    } else return createApiErrorResponse('UNSUPPORTED_EXPORT_FORMAT', `Unsupported format: ${format}.`, 400);
  } catch (error) {
    if ((error as { code?: string }).code === 'EXPORT_GRAPH_INVALID') {
      return createApiErrorResponse('EXPORT_GRAPH_INVALID', 'Canonical graph failed export validation.', 422);
    }
    return createApiErrorResponse('EXPORT_GENERATION_FAILED', 'Export generation failed.', 500);
  }

  const remainingTtlSeconds = Math.max(60, Math.floor((expiresEpoch - Date.now()) / 1000));
  await storePublicExport({
    pathname,
    bytes: file.bytes,
    contentType: file.mediaType,
    cacheControlMaxAge: remainingTtlSeconds,
    sha256: file.sha256,
  });

  let signed;
  try {
    signed = await createSignedDownloadUrl(pathname);
  } catch {
    return createApiErrorResponse('EXPORT_DOWNLOAD_UNAVAILABLE', 'Could not issue a secure export download.', 503, {
      fallbackAvailable: true,
    });
  }
  const exportId = await sha256Hex(`${sourceDigest}:${format}:1.0.0`);

  return NextResponse.json({
    exportId,
    format,
    filename: file.filename,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    sha256: file.sha256,
    cache: { layer: 'vercel-blob', hit: false, expiresAt: cached.pointer.expiresAt },
    download: { url: signed.url, expiresAt: signed.expiresAt },
  });
}

function filenameForFormat(
  manifest: { repository: { name: string }; sourceArtifactSha256: string },
  format: string
): string {
  return graphExportFilename(manifest as never, format as never);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
