import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/feedback/route';
import { storeAggregateFeedback } from '../../app/lib/feedback-store';
vi.mock('../../app/lib/feedback-store', () => ({ storeAggregateFeedback: vi.fn() }));
const payload = { usefulnessScore: 5, primaryUsecase: 'architecture', missingCapabilities: ['more_languages', 'diagram_export'], submissionId: '12345678-1234-4234-8234-123456789abc' };
beforeEach(() => { vi.mocked(storeAggregateFeedback).mockReset().mockResolvedValue(true); });

describe('/api/feedback API Route', () => {
  it('rejects submissions with missing or invalid usefulnessScore', async () => {
    const req = new NextRequest('http://localhost:3000/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ primaryUsecase: 'onboarding' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('accepts valid survey submissions with score, use case, and capabilities', async () => {
    const req = new NextRequest('http://localhost:3000/api/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(storeAggregateFeedback).toHaveBeenCalledWith(payload);
  });

  it.each([{ comments: 'secret' }, { primaryUsecase: 'arbitrary text' }, { missingCapabilities: ['credentials'] }])('rejects text or unknown choices: %j', async (extra) => {
    const result = await POST(new NextRequest('http://localhost/api/feedback', { method: 'POST', body: JSON.stringify({ ...payload, ...extra }) }));
    expect(result.status).toBe(400);
    expect(storeAggregateFeedback).not.toHaveBeenCalled();
  });
  it('does not acknowledge a store failure or throttle as success', async () => {
    for (const failure of ['storage', 'throttle']) {
      if (failure === 'storage') vi.mocked(storeAggregateFeedback).mockRejectedValueOnce(new Error('infrastructure secret'));
      else vi.mocked(storeAggregateFeedback).mockResolvedValueOnce(false);
      const result = await POST(new NextRequest('http://localhost/api/feedback', { method: 'POST', body: JSON.stringify(payload) }));
      expect(result.status).toBe(failure === 'storage' ? 503 : 429);
      expect(await result.json()).toMatchObject({ success: false });
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      if (failure === 'throttle') expect(result.headers.get('Retry-After')).toBe('60');
    }
  });
});
