import { describe, expect, it } from 'vitest';

import { BoundedJsonError, readBoundedJson } from '../../app/lib/bounded-json';

describe('bounded JSON request reader', () => {
  it('parses a body within the byte limit', async () => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/owner/repo' }),
    });
    await expect(readBoundedJson<{ url: string }>(request, 100)).resolves.toEqual({
      url: 'https://github.com/owner/repo',
    });
  });

  it('rejects a declared oversized body before consuming it', async () => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '500' },
      body: '{}',
    });
    await expect(readBoundedJson(request, 10)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    } satisfies Partial<BoundedJsonError>);
  });

  it('counts UTF-8 bytes and distinguishes malformed JSON', async () => {
    const oversized = new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ value: 'ééé' }) });
    await expect(readBoundedJson(oversized, 8)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });

    const malformed = new Request('http://localhost/api', { method: 'POST', body: '{nope' });
    await expect(readBoundedJson(malformed, 100)).rejects.toMatchObject({ code: 'INVALID_JSON' });
  });
});
