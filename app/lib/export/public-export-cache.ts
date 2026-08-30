import { del, get, head, issueSignedToken, list, presignUrl, put } from '@vercel/blob';

import { PUBLIC_ARTIFACT_TTL_SECONDS, V2_ANALYZER_VERSION, isPublicArtifactCacheConfigured } from '../analyzer/v2/artifact-cache';
import { GRAPH_EXPORT_EXTENSIONS, type GraphExportFormat } from './graph/types';
import { sha256Hex } from './graph/stable-json';

const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
export const MAX_PUBLIC_EXPORT_BYTES = 128 * 1024 * 1024;
const MAX_EXPORT_METADATA_BYTES = 16 * 1024;

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

export interface PublicExportMetadata {
  byteSize: number;
  sha256: string;
  mediaType: string;
}

export function publicExportMetadataPath(pathname: string): string {
  return `${pathname}.metadata.json`;
}

export async function createSignedDownloadUrl(pathname: string): Promise<{ url: string; expiresAt: string }> {
  const validUntil = Date.now() + SIGNED_URL_TTL_MS;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const result = await presignUrl(token, {
    operation: 'get',
    pathname,
    validUntil,
    access: 'private',
  });
  return { url: result.presignedUrl, expiresAt: new Date(validUntil).toISOString() };
}

export async function readCachedPublicExport(
  pathname: string
): Promise<{ url: string; downloadUrl: string; metadata: PublicExportMetadata } | null> {
  if (!isPublicExportCacheConfigured()) return null;
  const result = await get(pathname, { access: 'private' }).catch(() => null);
  if (!result || result.statusCode !== 200) return null;
  if (result.blob.size > MAX_PUBLIC_EXPORT_BYTES) {
    await Promise.all([
      del(pathname).catch(() => undefined),
      del(publicExportMetadataPath(pathname)).catch(() => undefined),
    ]);
    return null;
  }
  const expiresSegment = pathname.split('/').find((segment) => segment.startsWith('expires-'));
  if (expiresSegment) {
    const epoch = Number(expiresSegment.replace('expires-', ''));
    if (Number.isFinite(epoch) && epoch <= Date.now()) {
      await del(pathname).catch(() => undefined);
      return null;
    }
  }
  const metadataPath = publicExportMetadataPath(pathname);
  const metadataResult = await get(metadataPath, { access: 'private' }).catch(() => null);
  let metadata: PublicExportMetadata | null = null;
  if (metadataResult?.statusCode === 200 && metadataResult.blob.size <= MAX_EXPORT_METADATA_BYTES) {
    try {
      metadata = (await new Response(metadataResult.stream).json()) as PublicExportMetadata;
    } catch {
      metadata = null;
    }
  }
  if (!metadata || !/^[0-9a-f]{64}$/.test(metadata.sha256) || metadata.byteSize !== result.blob.size) {
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    metadata = {
      byteSize: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      mediaType: result.blob.contentType,
    };
    await put(metadataPath, JSON.stringify(metadata), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
    }).catch(() => undefined);
  }
  return {
    url: result.blob.url,
    downloadUrl: (result.blob as unknown as { downloadUrl?: string }).downloadUrl ?? result.blob.url,
    metadata,
  };
}

export async function storePublicExport(input: {
  pathname: string;
  bytes: Uint8Array;
  contentType: string;
  cacheControlMaxAge: number;
  sha256: string;
}): Promise<{ url: string; pathname: string }> {
  if (input.bytes.byteLength > MAX_PUBLIC_EXPORT_BYTES) {
    throw new Error('PUBLIC_EXPORT_TOO_LARGE');
  }
  const result = await put(input.pathname, input.bytes, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: input.cacheControlMaxAge,
    contentType: input.contentType,
  });
  await put(publicExportMetadataPath(input.pathname), JSON.stringify({
    byteSize: input.bytes.byteLength,
    sha256: input.sha256,
    mediaType: input.contentType,
  } satisfies PublicExportMetadata), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: input.cacheControlMaxAge,
    contentType: 'application/json; charset=utf-8',
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
