import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface ExportRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
  quotaType: 'public' | 'authenticated';
}

let redisInstance: Redis | null = null;
let publicExportRatelimit: Ratelimit | null = null;
let authExportRatelimit: Ratelimit | null = null;

const memoryWindows = new Map<string, number[]>();

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redisInstance) redisInstance = new Redis({ url, token });
  return redisInstance;
}

function getRatelimiter(type: 'public' | 'authenticated'): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  if (type === 'public') {
    if (!publicExportRatelimit) {
      publicExportRatelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, '10 m'),
        analytics: true,
        prefix: 'repodna:ratelimit:export:public',
      });
    }
    return publicExportRatelimit;
  }
  if (!authExportRatelimit) {
    authExportRatelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '10 m'),
      analytics: true,
      prefix: 'repodna:ratelimit:export:auth',
    });
  }
  return authExportRatelimit;
}

function checkMemoryRateLimit(identifier: string, limit: number, quotaType: 'public' | 'authenticated'): ExportRateLimitResult {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const timestamps = (memoryWindows.get(identifier) || []).filter((value) => now - value < windowMs);
  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const reset = oldest + windowMs;
    return {
      allowed: false,
      limit,
      remaining: 0,
      reset,
      retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)),
      quotaType,
    };
  }
  timestamps.push(now);
  memoryWindows.set(identifier, timestamps);
  return { allowed: true, limit, remaining: limit - timestamps.length, reset: now + windowMs, quotaType };
}

export async function checkExportRateLimit(input: {
  ip: string;
  userId?: string | null;
}): Promise<ExportRateLimitResult> {
  const isAuthenticated = Boolean(input.userId && input.userId !== 'anonymous');
  const quotaType = isAuthenticated ? 'authenticated' : 'public';
  const limit = isAuthenticated ? 60 : 20;
  const identifier = isAuthenticated ? `user_${input.userId}` : `ip_${input.ip}`;
  const ratelimiter = getRatelimiter(quotaType);
  if (ratelimiter) {
    try {
      const result = await ratelimiter.limit(identifier);
      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        retryAfter: result.success ? undefined : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
        quotaType,
      };
    } catch (error) {
      const err = new Error('Rate limit infrastructure unavailable') as Error & { code: string };
      err.code = 'RATE_LIMIT_UNAVAILABLE';
      throw err;
    }
  }
  if (process.env.NODE_ENV === 'production') {
    const err = new Error('Rate limit infrastructure unavailable') as Error & { code: string };
    err.code = 'RATE_LIMIT_UNAVAILABLE';
    throw err;
  }
  return checkMemoryRateLimit(identifier, limit, quotaType);
}

export function resetExportRateLimitMemory(): void {
  memoryWindows.clear();
}
