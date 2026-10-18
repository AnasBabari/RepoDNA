import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), configured: vi.fn(), start: vi.fn() }));
vi.mock('../../app/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('../../app/lib/ratelimit', () => ({ checkAnalysisRateLimit: mocks.rate }));
vi.mock('../../app/lib/analyzer/v2/artifact-cache', () => ({ isPublicArtifactCacheConfigured: mocks.configured }));
vi.mock('workflow/api', () => ({ start: mocks.start, getRun: vi.fn() }));
vi.mock('../../app/workflows/analyze-public-repository', () => ({ analyzePublicRepositoryWorkflow: vi.fn() }));
import { POST } from '../../app/api/v2/analyses/route';

const sha = 'c'.repeat(40);
const request = (path: string) => new NextRequest('http://localhost/api/v2/analyses', { method: 'POST', body: JSON.stringify({ url: `https://github.com/owner/repo${path}` }), headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user' }, accessToken: 'test-session-token' });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.configured.mockReturnValue(true);
  mocks.start.mockResolvedValue({ runId: 'wrun_ref_test' });
});
afterEach(() => vi.restoreAllMocks());

it.each([['', 'HEAD'], ['/tree/v2.31.0', 'v2.31.0'], ['/tree/feature%2Freview', 'feature/review']])('starts %s at a pinned public commit without serializing credentials', async (path, ref) => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ sha }));
  const response = await POST(request(path));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ commitSha: sha, repository: { url: `https://github.com/owner/repo/tree/${sha}` } });
  expect(mocks.start.mock.calls[0][1]).toEqual([{ owner: 'owner', repo: 'repo', commitSha: sha, requestedRef: ref, repositoryUrl: `https://github.com/owner/repo/tree/${sha}` }]);
  expect(JSON.stringify(mocks.start.mock.calls)).not.toContain('test-session-token');
  expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  expect(String(fetchMock.mock.calls[0][0])).toBe(`https://api.github.com/repos/owner/repo/commits/${encodeURIComponent(ref)}`);
});
it('returns an actionable 400 rather than scheduling an ambiguous URL', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ sha }));
  const response = await POST(request('/tree/feature/review'));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'GITHUB_REF_AMBIGUOUS', fallbackAvailable: false } });
  expect(mocks.start).not.toHaveBeenCalled();
});
it('does not schedule HEAD when the requested tag is missing', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
  const response = await POST(request('/tree/missing'));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: 'GITHUB_REF_NOT_FOUND' } });
  expect(mocks.start).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
