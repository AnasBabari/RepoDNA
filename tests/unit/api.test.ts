import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/analyze/route';
import * as ratelimitModule from '../../app/lib/ratelimit';
import * as analyzerModule from '../../app/lib/analyzer';
import { IngestionError } from '../../app/lib/analyzer/types';

describe('/api/analyze Route Handler', () => {
  it('returns 400 for GET without ?url= parameter', async () => {
    const req = new NextRequest('http://localhost:3000/api/analyze');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 for POST with malformed JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: 'invalid-json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('MALFORMED_JSON');
  });

  it('returns 400 for POST with missing url field', async () => {
    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ otherField: 'val' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    vi.spyOn(ratelimitModule, 'checkAnalysisRateLimit').mockResolvedValueOnce({
      allowed: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 60000,
      retryAfter: 60,
      quotaType: 'public',
    });

    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/owner/repo' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('RATE_LIMITED');
    expect(data.error.retryAfter).toBe(60);
    expect(res.headers.get('Retry-After')).toBe('60');

    vi.restoreAllMocks();
  });

  it('returns 503 when rate limit infrastructure is unavailable', async () => {
    vi.spyOn(ratelimitModule, 'checkAnalysisRateLimit').mockRejectedValueOnce(
      Object.assign(new Error('Rate limit infrastructure unavailable'), { code: 'RATE_LIMIT_UNAVAILABLE' })
    );

    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/owner/repo' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('RATE_LIMIT_UNAVAILABLE');

    vi.restoreAllMocks();
  });

  it('handles IngestionError with custom status codes (404, 413, 504)', async () => {
    vi.spyOn(ratelimitModule, 'checkAnalysisRateLimit').mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60000,
      quotaType: 'public',
    });

    vi.spyOn(analyzerModule, 'analyzeGitHubUrl').mockRejectedValueOnce(
      new IngestionError('REPO_NOT_FOUND', 'Repository was not found or is private', 404)
    );

    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/owner/missing' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('REPO_NOT_FOUND');

    vi.restoreAllMocks();
  });

  it('handles UPSTREAM_GITHUB_RATE_LIMITED with fallbackAvailable flag', async () => {
    vi.spyOn(ratelimitModule, 'checkAnalysisRateLimit').mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60000,
      quotaType: 'public',
    });

    vi.spyOn(analyzerModule, 'analyzeGitHubUrl').mockRejectedValueOnce(
      new IngestionError('UPSTREAM_GITHUB_RATE_LIMITED', 'GitHub API rate limit reached on server', 429)
    );

    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/pytorch/pytorch' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UPSTREAM_GITHUB_RATE_LIMITED');
    expect(data.error.fallbackAvailable).toBe(true);

    vi.restoreAllMocks();
  });

  it('fails closed with ANALYSIS_SCHEMA_ERROR when analyzer produces an invalid schema result', async () => {
    vi.spyOn(ratelimitModule, 'checkAnalysisRateLimit').mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60000,
      quotaType: 'public',
    });

    // Mock an invalid project missing required fields
    vi.spyOn(analyzerModule, 'analyzeGitHubUrl').mockResolvedValueOnce({
      schemaVersion: '1.1.0',
      // missing repository, files, symbols, etc.
    } as unknown as RepoDNAProject);

    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/owner/invalid-schema-repo' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('ANALYSIS_SCHEMA_ERROR');
    expect(data.error.message).toBe('Repository analysis produced an invalid result.');

    vi.restoreAllMocks();
  });

  it('sanitizes unexpected internal exceptions with a generic message and requestId', async () => {
    vi.spyOn(ratelimitModule, 'checkAnalysisRateLimit').mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60000,
      quotaType: 'public',
    });

    vi.spyOn(analyzerModule, 'analyzeGitHubUrl').mockRejectedValueOnce(
      new Error('Sensitive internal database connection failed at /var/secrets/key.pem')
    );

    const req = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/owner/repo' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('ANALYSIS_FAILED');
    expect(data.error.message).toBe('Repository analysis failed unexpectedly.');
    expect(data.error.message).not.toContain('/var/secrets');
    expect(data.error.requestId).toBeDefined();

    vi.restoreAllMocks();
  });
});
