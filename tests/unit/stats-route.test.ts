import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as StatsModule from '../../app/lib/stats/scanned-repositories';
import { GET } from '../../app/api/stats/route';

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/stats', () => {
  it('returns scannedRepositories count with updatedAt and no-store', async () => {
    vi.spyOn(StatsModule, 'getScannedPublicRepositoryCount').mockResolvedValue(123);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const data = (await res.json()) as { scannedRepositories: number; updatedAt: string };
    expect(data.scannedRepositories).toBe(123);
    expect(typeof data.updatedAt).toBe('string');
    expect(new Date(data.updatedAt).toISOString()).toBe(data.updatedAt);
    expect((data as unknown as { unavailable?: boolean }).unavailable).toBeUndefined();
  });

  it('returns controlled unavailable response when store not configured rather than 0', async () => {
    vi.spyOn(StatsModule, 'getScannedPublicRepositoryCount').mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const data = (await res.json()) as {
      scannedRepositories: null;
      unavailable: boolean;
      reason: string;
      updatedAt: string;
    };
    expect(data.scannedRepositories).toBeNull();
    expect(data.unavailable).toBe(true);
    expect(data.reason).toBe('STATS_UNAVAILABLE');
    expect(typeof data.updatedAt).toBe('string');
    expect(data.scannedRepositories).not.toBe(0);
  });

  it('does not invent fallback number when Redis fails', async () => {
    vi.spyOn(StatsModule, 'getScannedPublicRepositoryCount').mockResolvedValue(null);

    const res = await GET();
    const data = (await res.json()) as { scannedRepositories: number | null };
    expect(typeof data.scannedRepositories === 'number' ? data.scannedRepositories : null).toBeNull();
    expect(data.scannedRepositories).not.toBe(0);
  });

  it('produces updatedAt close to now for success case', async () => {
    vi.spyOn(StatsModule, 'getScannedPublicRepositoryCount').mockResolvedValue(42);
    const before = Date.now();
    const res = await GET();
    const data = (await res.json()) as { updatedAt: string };
    const after = Date.now();
    const ts = new Date(data.updatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it('produces updatedAt close to now for unavailable case', async () => {
    vi.spyOn(StatsModule, 'getScannedPublicRepositoryCount').mockResolvedValue(null);
    const before = Date.now();
    const res = await GET();
    const data = (await res.json()) as { updatedAt: string };
    const after = Date.now();
    const ts = new Date(data.updatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it('always sets Cache-Control no-store', async () => {
    vi.spyOn(StatsModule, 'getScannedPublicRepositoryCount').mockResolvedValue(5);
    expect((await GET()).headers.get('Cache-Control')).toBe('no-store');

    vi.spyOn(StatsModule, 'getScannedPublicRepositoryCount').mockResolvedValue(null);
    expect((await GET()).headers.get('Cache-Control')).toBe('no-store');
  });
});
