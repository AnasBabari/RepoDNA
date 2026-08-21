import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/github/repositories/route';

describe('GET /api/github/repositories', () => {
  it('returns 401 Unauthorized when request has no active session or OAuth token', async () => {
    const req = new NextRequest('http://localhost:3000/api/github/repositories');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });
});
