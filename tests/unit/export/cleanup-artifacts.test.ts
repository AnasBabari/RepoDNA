import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const blobMocks = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({ list: blobMocks.list, del: blobMocks.del }));

import { GET } from '../../../app/api/internal/cleanup-artifacts/route';

const originalCronSecret = process.env.CRON_SECRET;

function request(secret?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/cleanup-artifacts', {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe('artifact cleanup cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-test-secret';
    blobMocks.del.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it('fails closed when the secret is absent or mismatched', async () => {
    delete process.env.CRON_SECRET;
    const unconfigured = await GET(request());
    expect(unconfigured.status).toBe(503);
    expect((await unconfigured.json()).code).toBe('CRON_SECRET_NOT_CONFIGURED');

    process.env.CRON_SECRET = 'cron-test-secret';
    const unauthorized = await GET(request('wrong-secret'));
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).code).toBe('UNAUTHORIZED');
    expect(blobMocks.list).not.toHaveBeenCalled();
  });

  it('paginates, deletes only expired canonical/derived blobs, and returns aggregate counts', async () => {
    const now = Date.now();
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000);
    const fresh = new Date(now - 60_000);
    const expiredEpoch = now - 1_000;
    const futureEpoch = now + 86_400_000;
    const expiredPrefix = `repodna/public/o/r/c/2.0.0/exports/1.0.0/d/expires-${expiredEpoch}`;

    blobMocks.list
      .mockResolvedValueOnce({
        blobs: [
          { pathname: 'repodna/public/o/r/a/2.0.0/repodna-v2.json', uploadedAt: old, url: 'private' },
          { pathname: 'repodna/public/o/r/b/2.0.0/repodna-v2.json', uploadedAt: fresh, url: 'private' },
          { pathname: `${expiredPrefix}/csv.zip`, uploadedAt: fresh, url: 'private' },
          { pathname: `${expiredPrefix}/csv.zip.metadata.json`, uploadedAt: fresh, url: 'private' },
          { pathname: `repodna/public/o/r/c/2.0.0/exports/1.0.0/d/expires-${futureEpoch}/csv.zip`, uploadedAt: fresh, url: 'private' },
        ],
        hasMore: true,
        cursor: 'next-page',
      })
      .mockResolvedValueOnce({
        blobs: [
          { pathname: 'repodna/public/o/r/d/2.0.0/repodna-v2.json', uploadedAt: old, url: 'private' },
        ],
        hasMore: false,
      });

    const response = await GET(request('cron-test-secret'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ processed: 6, deletedCanonical: 2, deletedExports: 2, deletedTotal: 4, failedDeletions: 0, failedBatches: 0 });
    expect(blobMocks.list).toHaveBeenNthCalledWith(1, expect.objectContaining({ prefix: 'repodna/public/' }));
    expect(blobMocks.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'next-page' }));
    const deleted = blobMocks.del.mock.calls.flatMap((call) => call[0] as string[]);
    expect(deleted).toEqual(expect.arrayContaining([
      'repodna/public/o/r/a/2.0.0/repodna-v2.json',
      'repodna/public/o/r/d/2.0.0/repodna-v2.json',
      `${expiredPrefix}/csv.zip`,
      `${expiredPrefix}/csv.zip.metadata.json`,
    ]));
    expect(deleted.some((pathname) => pathname.includes(`expires-${futureEpoch}`))).toBe(false);
  });

  it('counts deletions that fail instead of crediting them as deleted', async () => {
    const now = Date.now();
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000);
    const expiredEpoch = now - 1_000;
    const expiredPrefix = `repodna/public/o/r/e/2.0.0/exports/1.0.0/f/expires-${expiredEpoch}`;

    blobMocks.list.mockResolvedValueOnce({
      blobs: [
        { pathname: 'repodna/public/o/r/g/2.0.0/repodna-v2.json', uploadedAt: old, url: 'private' },
        { pathname: `${expiredPrefix}/csv.zip`, uploadedAt: old, url: 'private' },
        { pathname: `${expiredPrefix}/csv.zip.metadata.json`, uploadedAt: old, url: 'private' },
      ],
      hasMore: false,
    });
    blobMocks.del.mockRejectedValueOnce(new Error('blob store unavailable'));

    const response = await GET(request('cron-test-secret'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.processed).toBe(3);
    // The failed batch (canonical + 2 export pathnames) must be excluded from
    // deleted counts and reported via failedDeletions instead.
    expect(data.deletedCanonical).toBe(0);
    expect(data.deletedExports).toBe(0);
    expect(data.deletedTotal).toBe(0);
    expect(data.failedDeletions).toBe(3);
    expect(data.failedBatches).toBe(1);

    const raw = JSON.stringify(data);
    expect(raw).not.toContain('repodna/');
    expect(raw.toLowerCase()).not.toContain('unavailable');
    expect(raw.toLowerCase()).not.toContain('error');
  });
});
