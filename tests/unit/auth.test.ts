import { describe, expect, it } from 'vitest';
import { generatePseudonymousId, AUTH_MAX_AGE_SECONDS } from '../../app/lib/auth';

describe('Auth.js & Pseudonymous Identity', () => {
  it('generates a deterministic, 16-character pseudonymous hash', () => {
    const id1 = generatePseudonymousId('github_user_12345', 'test-secret');
    const id2 = generatePseudonymousId('github_user_12345', 'test-secret');

    expect(id1).toBe(id2);
    expect(id1.length).toBe(16);
    expect(/^[a-f0-9]+$/.test(id1)).toBe(true);
  });

  it('generates different pseudonymous hashes for different users or secrets', () => {
    const userA = generatePseudonymousId('12345', 'secret-key');
    const userB = generatePseudonymousId('67890', 'secret-key');
    const userDifferentSecret = generatePseudonymousId('12345', 'other-key');

    expect(userA).not.toBe(userB);
    expect(userA).not.toBe(userDifferentSecret);
  });

  it('enforces an 8-hour maximum session lifetime', () => {
    expect(AUTH_MAX_AGE_SECONDS).toBe(8 * 60 * 60);
  });
});
