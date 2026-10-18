import { Redis } from '@upstash/redis';
import type { AggregateFeedback } from './feedback-contract';

export const FEEDBACK_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const FEEDBACK_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 1 end
local requests = redis.call('INCR', KEYS[3])
if requests == 1 then redis.call('EXPIRE', KEYS[3], 60) end
if requests > 120 then return 0 end
for index = 2, #ARGV do redis.call('HINCRBY', KEYS[1], ARGV[index], 1) end
redis.call('EXPIREAT', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], '1', 'EX', 86400)
return 1
`;

/** Fixed, low-cardinality daily aggregates only; no user, IP, repository or text fields. */
export async function storeAggregateFeedback(payload: AggregateFeedback, now = new Date()): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('FEEDBACK_UNAVAILABLE');
  // Never replay a possibly accepted increment after a lost network acknowledgement.
  const redis = new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(5_000) });
  const day = now.toISOString().slice(0, 10);
  const expiry = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + FEEDBACK_RETENTION_SECONDS;
  const fields = ['total', `rating:${payload.usefulnessScore}`, `usecase:${payload.primaryUsecase}`,
    ...payload.missingCapabilities.map((item) => `capability:${item}`)];
  const result = await redis.eval<number>(FEEDBACK_SCRIPT, [
    `repodna:feedback:v1:daily:${day}`, `repodna:feedback:v1:ack:${payload.submissionId}`,
    `repodna:feedback:v1:rate:${Math.floor(now.getTime() / 60_000)}`,
  ], [expiry, ...fields]);
  if (result !== 0 && result !== 1) throw new Error('FEEDBACK_UNAVAILABLE');
  return result === 1;
}
