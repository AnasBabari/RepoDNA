import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blobMocks = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  issueSignedToken: vi.fn(),
  list: vi.fn(),
  presignUrl: vi.fn(),
  put: vi.fn(),
}));

vi.mock('@vercel/blob', () => blobMocks);

import {
  createSignedDownloadUrl,
  publicExportBlobPath,
  publicExportMetadataPath,
  readCachedPublicExport,
  storePublicExport,
} from '../../../app/lib/export/public-export-cache';

const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

describe('public export Blob cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';
    blobMocks.del.mockResolvedValue(undefined);
    blobMocks.issueSignedToken.mockResolvedValue({
      clientSigningToken: 'client-token',
      delegationToken: 'delegation-token',
    });
    blobMocks.presignUrl.mockResolvedValue({ presignedUrl: 'https://blob.example.test/signed' });
    blobMocks.put.mockImplementation(async (pathname: string) => ({
      pathname,
      url: `https://blob.example.test/${pathname}`,
    }));
  });

  afterEach(() => {
    if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  });

  it('uses deterministic sanitized commit/export paths and sidecar metadata paths', () => {
    const pathname = publicExportBlobPath({
      owner: 'Graphify-Labs',
      repo: 'Graphify Repo',
      commitSha: 'A'.repeat(40),
      sourceDigest: 'b'.repeat(64),
      expiresEpoch: 1_800_000_000_000,
      format: 'csv',
    });
    expect(pathname).toBe(
      `repodna/public/graphify-labs/graphify-repo/${'a'.repeat(40)}/2.0.0/exports/1.0.0/${'b'.repeat(64)}/expires-1800000000000/csv.zip`
    );
    expect(publicExportMetadataPath(pathname)).toBe(`${pathname}.metadata.json`);
  });

  it('issues a five-minute pathname-scoped private GET URL', async () => {
    const before = Date.now();
    const signed = await createSignedDownloadUrl('repodna/public/export.json');
    const after = Date.now();

    expect(signed.url).toBe('https://blob.example.test/signed');
    expect(blobMocks.issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({
      pathname: 'repodna/public/export.json',
      operations: ['get'],
      validUntil: expect.any(Number),
    }));
    expect(blobMocks.presignUrl).toHaveBeenCalledWith(
      expect.objectContaining({ clientSigningToken: 'client-token', delegationToken: 'delegation-token' }),
      expect.objectContaining({
        operation: 'get',
        pathname: 'repodna/public/export.json',
        access: 'private',
      })
    );
    const expiry = Date.parse(signed.expiresAt);
    expect(expiry).toBeGreaterThanOrEqual(before + 299_000);
    expect(expiry).toBeLessThanOrEqual(after + 301_000);
  });

  it('stores export bytes and integrity metadata as private blobs', async () => {
    const bytes = new TextEncoder().encode('portable graph');
    await storePublicExport({
      pathname: 'repodna/public/export.graph.json',
      bytes,
      contentType: 'application/json',
      cacheControlMaxAge: 3600,
      sha256: 'c'.repeat(64),
    });

    expect(blobMocks.put).toHaveBeenCalledTimes(2);
    expect(blobMocks.put).toHaveBeenNthCalledWith(
      1,
      'repodna/public/export.graph.json',
      bytes,
      expect.objectContaining({ access: 'private', addRandomSuffix: false, allowOverwrite: true })
    );
    const metadataBody = blobMocks.put.mock.calls[1][1] as string;
    expect(JSON.parse(metadataBody)).toEqual({
      byteSize: bytes.byteLength,
      sha256: 'c'.repeat(64),
      mediaType: 'application/json',
    });
  });

  it('repairs a missing sidecar from cached bytes and returns complete metadata', async () => {
    const bytes = new TextEncoder().encode('cached graph bytes');
    blobMocks.get
      .mockResolvedValueOnce({
        statusCode: 200,
        stream: new Blob([bytes]).stream(),
        blob: {
          url: 'private-url',
          downloadUrl: 'private-download',
          uploadedAt: new Date(),
          size: bytes.byteLength,
          contentType: 'application/json',
        },
      })
      .mockResolvedValueOnce(null);

    const result = await readCachedPublicExport(
      `repodna/public/o/r/c/2.0.0/exports/1.0.0/d/expires-${Date.now() + 60_000}/graph-json.graph.json`
    );

    expect(result?.metadata.byteSize).toBe(bytes.byteLength);
    expect(result?.metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result?.metadata.mediaType).toBe('application/json');
    expect(blobMocks.put).toHaveBeenCalledTimes(1);
  });
});
