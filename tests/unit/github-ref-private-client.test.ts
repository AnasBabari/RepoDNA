import { afterEach, expect, it, vi } from 'vitest';
import { analyzePrivateRepositoryInBrowser } from '../../app/lib/deep-scan-client';

afterEach(() => vi.restoreAllMocks());

it.each(['nested', 'legacy'])('preserves %s private revision errors without exposing raw upstream text', async (shape) => {
  const details = { code: 'GITHUB_REF_AMBIGUOUS', message: 'secret path or upstream diagnostic' };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(shape === 'nested' ? { error: details } : details, { status: 400 }));
  const progress = vi.fn();
  const outcome = await analyzePrivateRepositoryInBrowser({ url: 'https://github.com/owner/private/tree/feature%2Freview', onProgress: progress });
  expect(outcome).toMatchObject({ authState: 'unavailable', code: details.code });
  expect('message' in outcome && outcome.message).toContain('multiple branch/tag boundaries');
  expect(JSON.stringify(outcome)).not.toContain(details.message);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/github/private-tree');
  expect(progress.mock.calls[0][0].message).not.toContain('25 MB');
});

it('retains nested expired-token state on the private root archive path', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { code: 'GITHUB_TOKEN_EXPIRED' } }, { status: 401 }));
  expect(await analyzePrivateRepositoryInBrowser({ url: 'https://github.com/owner/private' })).toMatchObject({ authState: 'expired', code: 'GITHUB_TOKEN_EXPIRED' });
});
