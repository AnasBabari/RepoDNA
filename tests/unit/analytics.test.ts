import { describe, expect, it } from 'vitest';
import {
  bucketDuration,
  bucketFileCount,
  sanitizeAnalyticsPayload,
} from '../../app/lib/analytics';

describe('Privacy-Safe PostHog Analytics Module', () => {
  it('correctly buckets durations into non-PII bins', () => {
    expect(bucketDuration(1200)).toBe('<5s');
    expect(bucketDuration(4999)).toBe('<5s');
    expect(bucketDuration(5000)).toBe('5-15s');
    expect(bucketDuration(14999)).toBe('5-15s');
    expect(bucketDuration(15000)).toBe('15-30s');
    expect(bucketDuration(29999)).toBe('15-30s');
    expect(bucketDuration(30000)).toBe('>30s');
    expect(bucketDuration(60000)).toBe('>30s');
  });

  it('correctly buckets file counts into non-PII bins', () => {
    expect(bucketFileCount(10)).toBe('<50');
    expect(bucketFileCount(49)).toBe('<50');
    expect(bucketFileCount(50)).toBe('50-200');
    expect(bucketFileCount(200)).toBe('50-200');
    expect(bucketFileCount(201)).toBe('200-1000');
    expect(bucketFileCount(1000)).toBe('200-1000');
    expect(bucketFileCount(1001)).toBe('1000+');
  });

  it('strictly sanitizes and strips all PII, URLs, file paths, and code snippets', () => {
    const rawPayload = {
      source_type: 'github_public',
      duration_bucket: '<5s',
      file_count_bucket: '50-200',
      // The following sensitive keys MUST be dropped:
      url: 'https://github.com/secret-org/secret-repo',
      repo: 'secret-org/secret-repo',
      name: 'UserService',
      path: 'src/controllers/auth.ts',
      code: 'function login() { return secret; }',
      token: 'ghp_secret_token_123',
      email: 'dev@company.com',
      stack: 'Error at /usr/local/lib/...',
    };

    const sanitized = sanitizeAnalyticsPayload(rawPayload);

    expect(sanitized.source_type).toBe('github_public');
    expect(sanitized.duration_bucket).toBe('<5s');
    expect(sanitized.file_count_bucket).toBe('50-200');

    expect(sanitized).not.toHaveProperty('url');
    expect(sanitized).not.toHaveProperty('repo');
    expect(sanitized).not.toHaveProperty('name');
    expect(sanitized).not.toHaveProperty('path');
    expect(sanitized).not.toHaveProperty('code');
    expect(sanitized).not.toHaveProperty('token');
    expect(sanitized).not.toHaveProperty('email');
    expect(sanitized).not.toHaveProperty('stack');
  });
});
