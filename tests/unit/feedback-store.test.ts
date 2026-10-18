import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FEEDBACK_RETENTION_SECONDS, FEEDBACK_SCRIPT, storeAggregateFeedback } from '../../app/lib/feedback-store';
import { parseAggregateFeedback } from '../../app/lib/feedback-contract';
const { evaluate, constructor } = vi.hoisted(() => ({ evaluate: vi.fn(), constructor: vi.fn() }));
vi.mock('@upstash/redis', () => ({ Redis: class { eval = evaluate; constructor(options: unknown) { constructor(options); } } }));
const payload = { usefulnessScore: 4, primaryUsecase: 'architecture', missingCapabilities: ['diagram_export'], submissionId: '12345678-1234-4234-8234-123456789abc' };
beforeEach(() => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic');
  evaluate.mockReset().mockResolvedValue(1);
});
afterEach(() => vi.unstubAllEnvs());
it('uses only bounded choices, fixed daily expiry and a separate expiring retry receipt/rate key', async () => {
  expect(await storeAggregateFeedback(payload, new Date('2026-10-18T23:59:00Z'))).toBe(true);
  expect(evaluate).toHaveBeenCalledWith(FEEDBACK_SCRIPT, [
    'repodna:feedback:v1:daily:2026-10-18', `repodna:feedback:v1:ack:${payload.submissionId}`, 'repodna:feedback:v1:rate:29872799',
  ], [Date.parse('2026-10-18T00:00:00Z') / 1000 + FEEDBACK_RETENTION_SECONDS, 'total', 'rating:4', 'usecase:architecture', 'capability:diagram_export']);
  expect(constructor).toHaveBeenCalledWith(expect.objectContaining({ retry: false, signal: expect.any(Function) }));
  expect(FEEDBACK_SCRIPT).toContain("redis.call('EXPIREAT', KEYS[1], ARGV[1])");
  expect(FEEDBACK_SCRIPT).toContain("'EX', 86400");
});
it('fails closed on missing credentials or unknown Redis acknowledgement', async () => {
  evaluate.mockResolvedValueOnce('unexpected');
  await expect(storeAggregateFeedback(payload)).rejects.toThrow('FEEDBACK_UNAVAILABLE');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  await expect(storeAggregateFeedback(payload)).rejects.toThrow('FEEDBACK_UNAVAILABLE');
});
it('strictly validates shapes, choices, UUIDs and deduplicates capabilities', () => {
  for (const invalid of [null, [], {}, { ...payload, comments: 'private' }, { ...payload, submissionId: 'identity' }, { ...payload, usefulnessScore: 4.5 }, { ...payload, missingCapabilities: [null] }]) {
    expect(parseAggregateFeedback(invalid)).toBeNull();
  }
  expect(parseAggregateFeedback({ ...payload, missingCapabilities: ['diagram_export', 'diagram_export'] })?.missingCapabilities).toEqual(['diagram_export']);
});
