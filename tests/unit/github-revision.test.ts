import { afterEach, expect, it, vi } from 'vitest';
import { parseGitHubUrl } from '../../app/lib/analyzer/ingestion';
import { resolveGitHubRevision, revisionCandidates } from '../../app/lib/github-revision';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const sha = 'b'.repeat(40);
const parse = (suffix = '') => parseGitHubUrl(`https://github.com/owner/repo${suffix}`)!;
it.each(['/tree/%2e%2e', '/tree/..', '/tree/tag%00', '/blob/main', '/tree/', '/issues/42'])('rejects unsupported or normalization-changing URL %s', (suffix) => {
  expect(parseGitHubUrl(`https://github.com/owner/repo${suffix}`)).toBeNull();
});
function mockRefs(refs: string[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const ref = decodeURIComponent(String(input).split('/commits/')[1]);
    return refs.includes(ref) ? Response.json({ sha }) : new Response(null, { status: 404 });
  });
}

it.each([
  ['', 'HEAD'], ['/tree/v2.31.0', 'v2.31.0'], [`/tree/${sha}`, sha],
  ['/blob/v2.31.0/src/index.py', 'v2.31.0'], ['/tree/feature%2Fnested', 'feature/nested'],
  ['/tree/feature/nested', 'feature/nested'], ['/blob/feature%2Fnested/src/index.py', 'feature/nested'],
])('resolves %s without substituting another branch', async (suffix, ref) => {
  const fetchMock = mockRefs([ref]);
  vi.stubEnv('GITHUB_TOKEN', 'ambient-token-must-not-be-used');
  expect(await resolveGitHubRevision(parse(suffix))).toEqual({ commitSha: sha, requestedRef: ref, sourceUrl: `https://github.com/owner/repo/tree/${sha}` });
  for (const [input, init] of fetchMock.mock.calls) {
    expect(init?.headers).not.toHaveProperty('Authorization');
    if (suffix) expect(String(input)).not.toContain('/commits/HEAD');
  }
});

it('rejects ambiguous boundaries even when both refs point to the same commit', async () => {
  const fetchMock = mockRefs(['feature', 'feature/nested']);
  await expect(resolveGitHubRevision(parse('/tree/feature/nested'))).rejects.toMatchObject({ code: 'GITHUB_REF_AMBIGUOUS' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('never retries HEAD for an inaccessible or nonexistent ref', async () => {
  const fetchMock = mockRefs([]);
  await expect(resolveGitHubRevision(parse('/tree/missing'))).rejects.toMatchObject({ code: 'GITHUB_REF_NOT_FOUND' });
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://api.github.com/repos/owner/repo/commits/missing']);
});
it('bounds candidate work before issuing requests and accepts an immutable commit with a deep subpath', () => {
  expect(() => revisionCandidates(parse('/tree/a/b/c/d/e/f/g/h/i'))).toThrow('Too many possible');
  expect(revisionCandidates(parse(`/tree/${sha}/a/b/c/d/e/f/g/h/i`))).toEqual([sha]);
});
it.each([401, 403, 429, 500])('does not mistake upstream %i for an absent candidate', async (status) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
  await expect(resolveGitHubRevision(parse('/tree/tag'))).rejects.toMatchObject({ status: status === 500 ? 502 : status });
});
it('requires a full SHA and uses only explicitly provided credentials', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ sha: 'short' }));
  await expect(resolveGitHubRevision(parse('/tree/tag'), { accessToken: 'test-session-token' })).rejects.toMatchObject({ code: 'UPSTREAM_GITHUB_ERROR' });
  expect(fetchMock.mock.calls[0][1]?.headers).toHaveProperty('Authorization', 'Bearer test-session-token');
});
