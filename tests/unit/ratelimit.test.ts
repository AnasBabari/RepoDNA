import { describe, expect, it } from 'vitest';
import { checkAnalysisRateLimit } from '../../app/lib/ratelimit';

describe('Multi-Tier Sliding Window Rate Limiter', () => {
  it('enforces public IP quota of 5 analyses per 10 minutes in memory', async () => {
    const ip = '192.168.1.50';

    for (let i = 0; i < 5; i++) {
      const res = await checkAnalysisRateLimit({ ip });
      expect(res.allowed).toBe(true);
      expect(res.quotaType).toBe('public');
      expect(res.limit).toBe(5);
    }

    const blocked = await checkAnalysisRateLimit({ ip });
    expect(blocked.allowed).toBe(false);
    expect(blocked.quotaType).toBe('public');
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('enforces authenticated user quota of 20 analyses per 10 minutes in memory', async () => {
    const userId = 'usr_pseudo_7788';
    const ip = '192.168.1.99';

    for (let i = 0; i < 20; i++) {
      const res = await checkAnalysisRateLimit({ ip, userId });
      expect(res.allowed).toBe(true);
      expect(res.quotaType).toBe('authenticated');
      expect(res.limit).toBe(20);
    }

    const blocked = await checkAnalysisRateLimit({ ip, userId });
    expect(blocked.allowed).toBe(false);
    expect(blocked.quotaType).toBe('authenticated');
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
