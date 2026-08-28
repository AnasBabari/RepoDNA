import { createHash } from 'node:crypto';

import { Redis } from '@upstash/redis';

export const SCANNED_REPOSITORIES_KEY = 'repodna:metrics:scanned-repositories:v1';

let redisInstance: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redisInstance) {
    redisInstance = new Redis({ url, token });
  }
  return redisInstance;
}

/**
 * Totally resets the memoized Redis client — test-only hook.
 */
export function __resetScannedRepositoriesRedisForTests(): void {
  redisInstance = null;
}

export function isScannedRepositoriesStoreConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function normalizeRepoIdentity(owner: string, repo: string): string | null {
  if (typeof owner !== 'string' || typeof repo !== 'string') return null;
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedRepo = repo.trim().toLowerCase().replace(/\.git$/i, '');
  if (!normalizedOwner || !normalizedRepo) return null;
  // Mirror the public ingestion guard: only a-z0-9._- segments are valid
  if (!/^[a-z0-9._-]+$/.test(normalizedOwner) || !/^[a-z0-9._-]+$/.test(normalizedRepo)) return null;
  return `${normalizedOwner}/${normalizedRepo}`;
}

export function hashRepoIdentity(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

export function hashOwnerRepo(owner: string, repo: string): string | null {
  const normalized = normalizeRepoIdentity(owner, repo);
  if (!normalized) return null;
  return hashRepoIdentity(normalized);
}

/**
 * Record a unique public repository that completed a successful server-side analysis.
 * The durable workflow and the legacy server fallback both use this hook.
 * Idempotent: repeated calls for the same owner/repo do not inflate the counter.
 * Never stores raw repository names, only the SHA-256 hash of the normalized identity.
 * Telemetry failure never throws to the caller — analysis must succeed regardless.
 */
export async function recordScannedPublicRepository(owner: string, repo: string): Promise<void> {
  const normalized = normalizeRepoIdentity(owner, repo);
  if (!normalized) return;

  const redis = getRedis();
  if (!redis) return;

  const hash = hashRepoIdentity(normalized);
  try {
    await redis.sadd(SCANNED_REPOSITORIES_KEY, hash);
  } catch (error) {
    // Telemetry must never fail the enclosing analysis.
    console.error('[Stats] Failed to record scanned repository', {
      // Never log raw names, only hash prefix for debugging collisions
      hashPrefix: hash.slice(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Returns the count of unique public repositories that completed server-side analysis,
 * or null when the backing store is unavailable / not configured.
 */
export async function getScannedPublicRepositoryCount(): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const count = await redis.scard(SCANNED_REPOSITORIES_KEY);
    if (typeof count !== 'number' || !Number.isFinite(count)) return null;
    return count;
  } catch (error) {
    console.error('[Stats] Failed to read scanned repository count', error);
    return null;
  }
}
