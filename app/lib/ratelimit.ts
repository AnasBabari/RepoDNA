import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
  quotaType: 'public' | 'authenticated';
}

let redisInstance: Redis | null = null;
let publicRatelimit: Ratelimit | null = null;
let authRatelimit: Ratelimit | null = null;

// In-memory fallback for local development when Upstash env vars are missing
const memoryWindows = new Map<string, number[]>();

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  if (!redisInstance) {
    redisInstance = new Redis({ url, token });
  }
  return redisInstance;
}

function getRatelimiter(type: 'public' | 'authenticated'): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  if (type === 'public') {
    if (!publicRatelimit) {
      publicRatelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, '10 m'), // 5 req / 10 min
        analytics: true,
        prefix: 'repodna:ratelimit:public',
      });
    }
    return publicRatelimit;
  }

  if (!authRatelimit) {
    authRatelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '10 m'), // 20 req / 10 min
      analytics: true,
      prefix: 'repodna:ratelimit:auth',
    });
  }
  return authRatelimit;
}

function checkMemoryRateLimit(identifier: string, limit: number, quotaType: 'public' | 'authenticated'): RateLimitResult {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes

  const timestamps = (memoryWindows.get(identifier) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const reset = oldest + windowMs;
    const retryAfter = Math.max(1, Math.ceil((reset - now) / 1000));
    return {
      allowed: false,
      limit,
      remaining: 0,
      reset,
      retryAfter,
      quotaType,
    };
  }

  timestamps.push(now);
  memoryWindows.set(identifier, timestamps);

  return {
    allowed: true,
    limit,
    remaining: limit - timestamps.length,
    reset: now + windowMs,
    quotaType,
  };
}

export async function checkAnalysisRateLimit({
  ip,
  userId,
}: {
  ip: string;
  userId?: string | null;
}): Promise<RateLimitResult> {
  const isAuthenticated = Boolean(userId && userId !== 'anonymous');
  const quotaType = isAuthenticated ? 'authenticated' : 'public';
  const limit = isAuthenticated ? 20 : 5;
  const identifier = isAuthenticated ? `user_${userId}` : `ip_${ip}`;

  const ratelimiter = getRatelimiter(quotaType);

  if (ratelimiter) {
    try {
      const result = await ratelimiter.limit(identifier);
      const retryAfter = result.success
        ? undefined
        : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));

      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        retryAfter,
        quotaType,
      };
    } catch (err) {
      console.error('[RateLimit] Upstash Redis infrastructure failure:', err);
      // Fail closed as required: throw an error indicating rate limit service is unavailable
      const error = new Error('Rate limit infrastructure unavailable');
      (error as Error & { code: string }).code = 'RATE_LIMIT_UNAVAILABLE';
      throw error;
    }
  }

  // Fallback to in-memory window when Upstash is not configured.
  // In production, distributed rate limiting is a security invariant — fail closed
  // if Upstash is missing so a horizontally-scaled deployment cannot bypass limits
  // via per-instance memory windows.
  if (process.env.NODE_ENV === 'production') {
    console.error('[RateLimit] Upstash Redis not configured in production — failing closed');
    const error = new Error('Rate limit infrastructure unavailable');
    (error as Error & { code: string }).code = 'RATE_LIMIT_UNAVAILABLE';
    throw error;
  }
  return checkMemoryRateLimit(identifier, limit, quotaType);
}

// Backwards-compatible public rate limit check
export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  return checkAnalysisRateLimit({ ip });
}
