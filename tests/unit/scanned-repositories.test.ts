import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSadd = vi.fn(async () => 1);
const mockScard = vi.fn(async () => 0);

// Mock @upstash/redis
vi.mock('@upstash/redis', () => {
  class FakeRedis {
    sadd = mockSadd;
    scard = mockScard;
  }
  return { Redis: FakeRedis };
});

import {
  __resetScannedRepositoriesRedisForTests,
  hashOwnerRepo,
  hashRepoIdentity,
  normalizeRepoIdentity,
  recordScannedPublicRepository,
  getScannedPublicRepositoryCount,
  SCANNED_REPOSITORIES_KEY,
  isScannedRepositoriesStoreConfigured,
} from '../../app/lib/stats/scanned-repositories';

const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

function setRedisEnv(configured: boolean) {
  if (configured) {
    process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  } else {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
  __resetScannedRepositoriesRedisForTests();
}

beforeEach(() => {
  mockSadd.mockClear();
  mockScard.mockClear();
  mockSadd.mockResolvedValue(1);
  mockScard.mockResolvedValue(7);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
  if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  __resetScannedRepositoriesRedisForTests();
});

describe('scanned-repositories normalization and hashing', () => {
  it('normalizes owner and repository names to lowercase trimmed identity', () => {
    expect(normalizeRepoIdentity('  Owner ', ' Repo ')).toBe('owner/repo');
    expect(normalizeRepoIdentity('OWNER', 'REPO')).toBe('owner/repo');
    expect(normalizeRepoIdentity('owner', 'repo.git')).toBe('owner/repo');
    expect(normalizeRepoIdentity('owner', 'Repo.GIT')).toBe('owner/repo');
  });

  it('is stable across case, whitespace and .git suffix variations', () => {
    const a = normalizeRepoIdentity('AnasBabari', 'RepoDNA.git');
    const b = normalizeRepoIdentity('anasbabari', 'repodna');
    const c = normalizeRepoIdentity('  ANASBABARI  ', '  RepoDNA  ');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe('anasbabari/repodna');
  });

  it('returns null for invalid identities', () => {
    expect(normalizeRepoIdentity('', 'repo')).toBeNull();
    expect(normalizeRepoIdentity('owner', '')).toBeNull();
    expect(normalizeRepoIdentity('owner!', 'repo')).toBeNull();
    expect(normalizeRepoIdentity('owner', 'repo/name')).toBeNull();
  });

  it('produces stable SHA-256 hex for identical normalized inputs', () => {
    const h1 = hashRepoIdentity('owner/repo');
    const h2 = hashRepoIdentity('owner/repo');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOwnerRepo('Owner', 'Repo')).toBe(hashOwnerRepo('owner', 'repo'));
  });

  it('hashOwnerRepo returns null for invalid inputs', () => {
    expect(hashOwnerRepo('', 'repo')).toBeNull();
    expect(hashOwnerRepo('owner', 'bad/repo')).toBeNull();
  });
});

describe('scanned-repositories store interaction', () => {
  it('stores hash via SADD and makes repeated analyses idempotent', async () => {
    setRedisEnv(true);
    // First call inserts 1, second call redis returns 0 (already member) — SCARD stays 1
    mockSadd.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    mockScard.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await recordScannedPublicRepository('owner', 'repo');
    expect(mockSadd).toHaveBeenCalledTimes(1);
    const firstArg = mockSadd.mock.calls[0][1] as string;
    expect(firstArg).toMatch(/^[0-9a-f]{64}$/);
    expect(mockSadd.mock.calls[0][0]).toBe(SCANNED_REPOSITORIES_KEY);
    expect(firstArg).not.toContain('owner');
    expect(firstArg).not.toContain('repo');

    await recordScannedPublicRepository('OWNER', 'REPO');
    expect(mockSadd).toHaveBeenCalledTimes(2);
    // Second hash must be identical (normalization)
    expect(mockSadd.mock.calls[1][1]).toBe(firstArg);

    // SCARD idempotent check — count does not double
    expect(await getScannedPublicRepositoryCount()).toBe(1);
    expect(await getScannedPublicRepositoryCount()).toBe(1);
  });

  it('hashes before storage and never stores raw repository names', async () => {
    setRedisEnv(true);
    await recordScannedPublicRepository('private-owner', 'secret-repo');
    const stored = String(mockSadd.mock.calls[0]?.[1] ?? '');
    expect(stored).not.toContain('secret-repo');
    expect(stored).not.toContain('private-owner');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails gracefully when Redis is unavailable and never throws', async () => {
    setRedisEnv(true);
    mockSadd.mockRejectedValueOnce(new Error('redis down'));
    await expect(recordScannedPublicRepository('owner', 'repo')).resolves.toBeUndefined();
    expect(mockSadd).toHaveBeenCalled();

    mockScard.mockRejectedValueOnce(new Error('redis down'));
    await expect(getScannedPublicRepositoryCount()).resolves.toBeNull();
  });

  it('returns null when store is not configured and does not call Redis', async () => {
    setRedisEnv(false);
    await recordScannedPublicRepository('owner', 'repo');
    expect(mockSadd).not.toHaveBeenCalled();

    const count = await getScannedPublicRepositoryCount();
    expect(count).toBeNull();
    expect(mockScard).not.toHaveBeenCalled();
    expect(isScannedRepositoriesStoreConfigured()).toBe(false);
  });

  it('does not record invalid identities', async () => {
    setRedisEnv(true);
    await recordScannedPublicRepository('', 'repo');
    await recordScannedPublicRepository('owner', '');
    await recordScannedPublicRepository('owner!', 'repo');
    expect(mockSadd).not.toHaveBeenCalled();
  });

  it('telemetry failure never causes analysis failure', async () => {
    setRedisEnv(true);
    mockSadd.mockRejectedValue(new Error('transient'));
    // Simulate the workflow hook: it should not throw even if Redis fails
    let threw = false;
    try {
      await recordScannedPublicRepository('owner', 'repo');
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe('scanned-repositories configuration', () => {
  it('reports configured when env vars are present', () => {
    setRedisEnv(true);
    expect(isScannedRepositoriesStoreConfigured()).toBe(true);
  });

  it('reports not configured when env vars are missing', () => {
    setRedisEnv(false);
    expect(isScannedRepositoriesStoreConfigured()).toBe(false);
  });
});
