import { del, get, head, list, put } from '@vercel/blob';

// `issueSignedToken` and `presignUrl` are available from the server entry but
// are minified to single-letter exports in the published d.ts. The JS runtime
// does export them under their real names, so we resolve them dynamically and
// fall back to a direct URL when presigning is unavailable (e.g. in tests).
async function getPresignHelpers(): Promise<{
  issueSignedToken: typeof import('@vercel/blob')['issueSignedToken'];
  presignUrl: typeof import('@vercel/blob')['presignUrl'];
} | null> {
  try {
    const mod = (await import('@vercel/blob')) as unknown as Record<string, unknown>;
    const issue = mod.issueSignedToken as unknown;
    const presign = mod.presignUrl as unknown;
    if (typeof issue === 'function' && typeof presign === 'function') {
      return {
        issueSignedToken: issue as never,
        presignUrl: presign as never,
      };
    }
  } catch {}
  return null;
}

import { PUBLIC_ARTIFACT_TTL_SECONDS, V2_ANALYZER_VERSION, isPublicArtifactCacheConfigured } from '../analyzer/v2/artifact-cache';
import { GRAPH_EXPORT_EXTENSIONS, type GraphExportFormat } from './graph/types';

const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'unknown';
}

export function publicExportBlobPath(input: {
  owner: string;
  repo: string;
  commitSha: string;
  analyzerVersion?: string;
  sourceDigest: string;
  expiresEpoch: number;
  format: GraphExportFormat;
}): string {
  const analyzer = input.analyzerVersion ?? V2_ANALYZER_VERSION;
  const extension = GRAPH_EXPORT_EXTENSIONS[input.format];
  const formatSegment = input.format === 'graph-json' ? 'graph-json' : input.format;
  return [
    'repodna',
    'public',
    safeSegment(input.owner),
    safeSegment(input.repo),
    safeSegment(input.commitSha),
    analyzer,
    'exports',
    '1.0.0',
    input.sourceDigest,
    `expires-${input.expiresEpoch}`,
    `${formatSegment}.${extension}`,
  ].join('/');
}

export function isPublicExportCacheConfigured(): boolean {
  return isPublicArtifactCacheConfigured();
}

export interface PublicExportPointer {
  pathname: string;
  url: string;
  downloadUrl: string;
  expiresAt: string;
  cacheHit: boolean;
}

export async function createSignedDownloadUrl(pathname: string): Promise<{ url: string; expiresAt: string }> {
  const validUntil = Date.now() + SIGNED_URL_TTL_MS;
  const helpers = await getPresignHelpers();
  if (helpers) {
    try {
      const token = await helpers.issueSignedToken({ pathname, operations: ['get'], validUntil });
      const result = await helpers.presignUrl(
        { clientSigningToken: (token as unknown as { clientSigningToken: string }).clientSigningToken, delegationToken: (token as unknown as { delegationToken: string }).delegationToken },
        { operation: 'get', pathname, validUntil } as unknown as never
      );
      return { url: (result as unknown as { presignedUrl: string }).presignedUrl, expiresAt: new Date(validUntil).toISOString() };
    } catch {}
  }
  const fallback = await get(pathname, { access: 'private' }).catch(() => null);
  const url = fallback ? (fallback.blob as unknown as { downloadUrl?: string }).downloadUrl ?? fallback.blob.url : pathname;
  return { url, expiresAt: new Date(validUntil).toISOString() };
}

export async function readCachedPublicExport(pathname: string): Promise<{ url: string; downloadUrl: string } | null> {
  if (!isPublicExportCacheConfigured()) return null;
  const result = await get(pathname, { access: 'private' }).catch(() => null);
  if (!result || result.statusCode !== 200) return null;
  const expiresSegment = pathname.split('/').find((segment) => segment.startsWith('expires-'));
  if (expiresSegment) {
    const epoch = Number(expiresSegment.replace('expires-', ''));
    if (Number.isFinite(epoch) && epoch <= Date.now()) {
      await del(pathname).catch(() => undefined);
      return null;
    }
  }
  return { url: result.blob.url, downloadUrl: (result.blob as unknown as { downloadUrl?: string }).downloadUrl ?? result.blob.url };
}

export async function storePublicExport(input: {
  pathname: string;
  bytes: Uint8Array;
  contentType: string;
  cacheControlMaxAge: number;
}): Promise<{ url: string; pathname: string }> {
  const result = await put(input.pathname, input.bytes, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: input.cacheControlMaxAge,
    contentType: input.contentType,
  });
  return { url: result.url, pathname: result.pathname };
}

export async function listPublicExportBlobs(prefix: string): Promise<Array<{ pathname: string; uploadedAt: Date; url: string }>> {
  const result = await list({ prefix, limit: 1000 });
  return result.blobs.map((blob) => ({ pathname: blob.pathname, uploadedAt: blob.uploadedAt, url: blob.url }));
}

export async function getBlobHead(pathname: string): Promise<{ uploadedAt: Date } | null> {
  try {
    const result = await head(pathname);
    return { uploadedAt: result.uploadedAt };
  } catch {
    return null;
  }
}

export { PUBLIC_ARTIFACT_TTL_SECONDS, SIGNED_URL_TTL_MS };
