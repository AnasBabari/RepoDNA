import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

let redisInstance: Redis | null = null;
let ratelimitInstance: Ratelimit | null = null;

// In-memory fallback for local development when Upstash env vars are missing
const memoryWindow = new Map<string, number[]>();

function getUpstashRatelimit(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  if (!ratelimitInstance) {
    redisInstance = new Redis({ url, token });
    ratelimitInstance = new Ratelimit({
      redis: redisInstance,
      limiter: Ratelimit.slidingWindow(5, '10 m'),
      analytics: true,
      prefix: 'repodna:ratelimit',
    });
  }

  return ratelimitInstance;
}

function checkMemoryRateLimit(identifier: string): RateLimitResult {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const limit = 5;

  const timestamps = (memoryWindow.get(identifier) || []).filter((t) => now - t < windowMs);

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
    };
  }

  timestamps.push(now);
  memoryWindow.set(identifier, timestamps);

  return {
    allowed: true,
    limit,
    remaining: limit - timestamps.length,
    reset: now + windowMs,
  };
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const ratelimiter = getUpstashRatelimit();

  if (ratelimiter) {
    try {
      const result = await ratelimiter.limit(ip);
      const retryAfter = result.success
        ? undefined
        : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));

      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        retryAfter,
      };
    } catch (err) {
      console.error('[RateLimit] Upstash Redis infrastructure failure:', err);
      // Fail closed as required: throw an error indicating rate limit service is unavailable
      const error = new Error('Rate limit infrastructure unavailable');
      (error as Error & { code: string }).code = 'RATE_LIMIT_UNAVAILABLE';
      throw error;
    }
  }

  // Fallback to in-memory window when Upstash is not configured (e.g. dev)
  return checkMemoryRateLimit(ip);
}
