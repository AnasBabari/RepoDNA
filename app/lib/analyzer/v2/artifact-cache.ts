import { del, get, put } from '@vercel/blob';

import type { RepoDNAProjectV2 } from './types';
import { validateRepoDNAProjectV2 } from '../../schema/safe-validator';

export const PUBLIC_ARTIFACT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const V2_ANALYZER_VERSION = '2.0.0';
export const MAX_PUBLIC_ARTIFACT_BYTES = 128 * 1024 * 1024;

export interface PublicArtifactSummary {
  schemaVersion: '2.0.0';
  coveragePercentage: number;
  nodeCount: number;
  edgeCount: number;
  unresolvedCount: number;
  completeness: RepoDNAProjectV2['completeness'];
  inventory: RepoDNAProjectV2['inventory'];
}
export interface PublicArtifactPointer {
  storage: 'vercel-blob';
  url: string;
  pathname: string;
  expiresAt: string;
  cacheHit: boolean;
}

export interface CachedPublicArtifact {
  project: RepoDNAProjectV2;
  summary: PublicArtifactSummary;
  pointer: PublicArtifactPointer;
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

export function publicArtifactPath(input: {
  owner: string;
  repo: string;
  commitSha: string;
}): string {
  return [
    'repodna',
    'public',
    safeSegment(input.owner),
    safeSegment(input.repo),
    safeSegment(input.commitSha),
    V2_ANALYZER_VERSION,
    'repodna-v2.json',
  ].join('/');
}

export function summarizePublicArtifact(project: RepoDNAProjectV2): PublicArtifactSummary {
  return {
    schemaVersion: project.schemaVersion,
    coveragePercentage: project.coverage.percentage,
    nodeCount: project.nodes.length,
    edgeCount: project.edges.length,
    unresolvedCount: project.unresolved.length,
    completeness: project.completeness,
    inventory: project.inventory,
  };
}

export function isPublicArtifactCacheConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)
  );
}

export async function readCachedPublicArtifact(input: {
  owner: string;
  repo: string;
  commitSha: string;
}): Promise<CachedPublicArtifact | null> {
  if (!isPublicArtifactCacheConfigured()) return null;

  const pathname = publicArtifactPath(input);
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200) return null;

  const uploadedAt = result.blob.uploadedAt;
  const expiresAtMs = uploadedAt.getTime() + PUBLIC_ARTIFACT_TTL_SECONDS * 1000;
  if (expiresAtMs <= Date.now()) {
    await del(pathname).catch(() => undefined);
    return null;
  }

  if (result.blob.size > MAX_PUBLIC_ARTIFACT_BYTES) {
    await del(pathname).catch(() => undefined);
    return null;
  }

  let project: RepoDNAProjectV2;
  try {
    project = JSON.parse(await new Response(result.stream).text()) as RepoDNAProjectV2;
  } catch {
    await del(pathname).catch(() => undefined);
    return null;
  }
  if (!validateRepoDNAProjectV2(project).valid) {
    await del(pathname).catch(() => undefined);
    return null;
  }
  return {
    project,
    summary: summarizePublicArtifact(project),
    pointer: {
      storage: 'vercel-blob',
      url: result.blob.url,
      pathname,
      expiresAt: new Date(expiresAtMs).toISOString(),
      cacheHit: true,
    },
  };
}

export async function storePublicArtifact(input: {
  owner: string;
  repo: string;
  commitSha: string;
  project: RepoDNAProjectV2;
}): Promise<CachedPublicArtifact> {
  if (!isPublicArtifactCacheConfigured()) {
    throw new Error('PUBLIC_ARTIFACT_CACHE_NOT_CONFIGURED');
  }
  if (!validateRepoDNAProjectV2(input.project).valid) {
    throw new Error('PUBLIC_ARTIFACT_SCHEMA_INVALID');
  }

  const pathname = publicArtifactPath(input);
  const serialized = JSON.stringify(input.project);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PUBLIC_ARTIFACT_BYTES) {
    throw new Error('PUBLIC_ARTIFACT_TOO_LARGE');
  }
  const stored = await put(pathname, serialized, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: PUBLIC_ARTIFACT_TTL_SECONDS,
    contentType: 'application/json; charset=utf-8',
  });
  const expiresAt = new Date(Date.now() + PUBLIC_ARTIFACT_TTL_SECONDS * 1000).toISOString();

  return {
    project: input.project,
    summary: summarizePublicArtifact(input.project),
    pointer: {
      storage: 'vercel-blob',
      url: stored.url,
      pathname: stored.pathname,
      expiresAt,
      cacheHit: false,
    },
  };
}
