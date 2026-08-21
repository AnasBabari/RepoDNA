import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/feedback/route';

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
      body: JSON.stringify({
        usefulnessScore: 5,
        primaryUsecase: 'architecture',
        missingCapabilities: ['more_languages', 'diagram_export'],
        comments: 'Great tool for visual architecture mapping!',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
