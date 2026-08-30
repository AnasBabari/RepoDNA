import { describe, expect, it } from 'vitest';
import { getUserFacingErrorMessage } from '../../app/lib/user-facing-errors';

describe('user-facing error messages', () => {
  it('maps known upstream failures without exposing their raw message', () => {
    const raw = Object.assign(new Error('fetch https://x-access-token:secret@github.com/private/repo failed'), {
      code: 'UPSTREAM_GITHUB_ERROR',
    });

    const message = getUserFacingErrorMessage(raw, 'fallback');

    expect(message).toContain('GitHub could not provide');
    expect(message).not.toContain('x-access-token');
    expect(message).not.toContain('private/repo');
  });

  it('uses the explicit code when the thrown error has no code', () => {
    expect(getUserFacingErrorMessage(new Error('raw internal detail'), 'fallback', 'REPO_NOT_FOUND')).toContain('could not find');
  });

  it('uses the caller fallback for unknown errors', () => {
    expect(getUserFacingErrorMessage(new Error('raw internal detail'), 'Safe fallback')).toBe('Safe fallback');
  });

  it('maps cache, parser, and export failures to stable product copy', () => {
    expect(getUserFacingErrorMessage({ code: 'PUBLIC_ARTIFACT_CACHE_NOT_CONFIGURED' }, 'raw')).toContain('temporarily unavailable');
    expect(getUserFacingErrorMessage({ code: 'UNSUPPORTED_LANGUAGE' }, 'raw')).toContain('cannot parse');
    expect(getUserFacingErrorMessage({ code: 'EXPORT_CACHE_WRITE_FAILED' }, 'raw')).toContain('saved securely');
  });
});
