import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { makeV2Fixture } from './fixtures';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkExportRateLimit: vi.fn(),
  readCachedPublicArtifact: vi.fn(),
  isPublicExportCacheConfigured: vi.fn(),
  publicExportBlobPath: vi.fn(),
  readCachedPublicExport: vi.fn(),
  storePublicExport: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock('../../../app/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('../../../app/lib/export/export-rate-limit', () => ({
  checkExportRateLimit: mocks.checkExportRateLimit,
}));
vi.mock('../../../app/lib/analyzer/v2/artifact-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../app/lib/analyzer/v2/artifact-cache')>();
  return { ...actual, readCachedPublicArtifact: mocks.readCachedPublicArtifact };
});
vi.mock('../../../app/lib/export/public-export-cache', () => ({
  isPublicExportCacheConfigured: mocks.isPublicExportCacheConfigured,
  publicExportBlobPath: mocks.publicExportBlobPath,
  readCachedPublicExport: mocks.readCachedPublicExport,
  storePublicExport: mocks.storePublicExport,
  createSignedDownloadUrl: mocks.createSignedDownloadUrl,
}));

import { POST } from '../../../app/api/v2/exports/route';

const OWNER = 'example-owner';
const REPO = 'example-repo';
const COMMIT = 'a'.repeat(40);

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v2/exports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.8' },
    body: JSON.stringify(body),
  });
}

function validBody(format = 'graph-json') {
  return { owner: OWNER, repo: REPO, commitSha: COMMIT, format, exportSchemaVersion: '1.0.0' };
}

describe('POST /api/v2/exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(null);
    mocks.checkExportRateLimit.mockResolvedValue({
      allowed: true,
      limit: 20,
      remaining: 19,
      reset: Date.now() + 60_000,
      quotaType: 'public',
    });
    mocks.isPublicExportCacheConfigured.mockReturnValue(true);
    mocks.publicExportBlobPath.mockReturnValue('repodna/public/export.graph.json');
    mocks.readCachedPublicExport.mockResolvedValue(null);
    mocks.storePublicExport.mockResolvedValue({ url: 'private-url', pathname: 'repodna/public/export.graph.json' });
    mocks.createSignedDownloadUrl.mockResolvedValue({
      url: 'https://blob.example.test/signed-download',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    mocks.readCachedPublicArtifact.mockResolvedValue({
      project: makeV2Fixture(),
      summary: {},
      pointer: {
        storage: 'vercel-blob',
        url: 'private-url',
        pathname: 'repodna/public/repodna-v2.json',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        cacheHit: true,
      },
    });
  });

  it('rejects unexpected fields and malformed commit identities', async () => {
    const extraResponse = await POST(request({ ...validBody(), repositoryUrl: 'secret' }));
    expect(extraResponse.status).toBe(400);
    expect((await extraResponse.json()).error.code).toBe('INVALID_EXPORT_REQUEST');

    const uppercaseResponse = await POST(request({ ...validBody(), commitSha: 'A'.repeat(40) }));
    expect(uppercaseResponse.status).toBe(400);
    expect((await uppercaseResponse.json()).error.code).toBe('INVALID_EXPORT_REQUEST');
  });

  it('enforces the dedicated export rate limit', async () => {
    mocks.checkExportRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 20,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
      quotaType: 'public',
    });

    const response = await POST(request(validBody()));
    const data = await response.json();
    expect(response.status).toBe(429);
    expect(data.error).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 60 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('fails closed when Blob or rate-limit infrastructure is unavailable', async () => {
    mocks.isPublicExportCacheConfigured.mockReturnValueOnce(false);
    const noBlob = await POST(request(validBody()));
    expect(noBlob.status).toBe(503);
    expect((await noBlob.json()).error).toMatchObject({
      code: 'EXPORT_CACHE_UNAVAILABLE',
      fallbackAvailable: true,
    });

    mocks.checkExportRateLimit.mockRejectedValueOnce(
      Object.assign(new Error('unavailable'), { code: 'RATE_LIMIT_UNAVAILABLE' })
    );
    const noLimiter = await POST(request(validBody()));
    expect(noLimiter.status).toBe(503);
    expect((await noLimiter.json()).error).toMatchObject({
      code: 'RATE_LIMIT_UNAVAILABLE',
      fallbackAvailable: true,
    });
  });

  it('requires a valid cached canonical v2 artifact', async () => {
    mocks.readCachedPublicArtifact.mockResolvedValueOnce(null);
    const missing = await POST(request(validBody()));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('ANALYSIS_ARTIFACT_NOT_FOUND');

    mocks.readCachedPublicArtifact.mockResolvedValueOnce({
      project: { schemaVersion: '2.0.0' },
      summary: {},
      pointer: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    const invalid = await POST(request(validBody()));
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe('ANALYSIS_SCHEMA_ERROR');
  });

  it('generates, stores, and signs a cache miss with complete integrity metadata', async () => {
    const response = await POST(request(validBody('graph-json')));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      format: 'graph-json',
      mediaType: 'application/vnd.repodna.graph+json; charset=utf-8',
      cache: { layer: 'vercel-blob', hit: false },
      download: { url: 'https://blob.example.test/signed-download' },
    });
    expect(data.byteSize).toBeGreaterThan(100);
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.storePublicExport).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: 'repodna/public/export.graph.json',
        sha256: data.sha256,
      })
    );
  });

  it('returns a controlled response when the private export cache write fails', async () => {
    mocks.storePublicExport.mockRejectedValueOnce(new Error('blob credential details'));

    const response = await POST(request(validBody('graph-json')));
    const data = await response.json();
    expect(response.status).toBe(503);
    expect(data.error).toMatchObject({
      code: 'EXPORT_CACHE_WRITE_FAILED',
      message: 'The export could not be stored securely.',
      fallbackAvailable: true,
    });
    expect(JSON.stringify(data)).not.toContain('credential details');
  });

  it('returns metadata from a Blob hit without regenerating the export', async () => {
    mocks.readCachedPublicExport.mockResolvedValueOnce({
      url: 'private-url',
      downloadUrl: 'private-download-url',
      metadata: {
        byteSize: 4321,
        sha256: 'b'.repeat(64),
        mediaType: 'application/zip',
      },
    });

    const response = await POST(request(validBody('csv')));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      format: 'csv',
      byteSize: 4321,
      sha256: 'b'.repeat(64),
      mediaType: 'application/zip',
      cache: { layer: 'vercel-blob', hit: true },
    });
    expect(mocks.storePublicExport).not.toHaveBeenCalled();
  });

  it('keeps Parquet hidden behind the production gate', async () => {
    const previous = process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT;
    delete process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT;
    try {
      const response = await POST(request(validBody('parquet')));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('PARQUET_EXPORT_DISABLED');
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT;
      else process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT = previous;
    }
  });
});
