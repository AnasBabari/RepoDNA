import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateDevelopmentAudit, verifyDevelopmentReachability } from '../security/development-audit.mjs';

const mitigation = JSON.parse(readFileSync('tests/security/development-mitigation.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const entry = { severity: 'high', nodes: ['node_modules/braces'], via: [{ url: mitigation.advisory, name: 'braces' }] };
const audit = { vulnerabilities: { braces: entry } };
const reviewedAt = Date.parse('2026-10-18T00:00:00Z');
describe('development-only risk is bounded, never silently allowlisted', () => {
  it('accepts only the known dev chain within the maintainer review window', () => {
    expect(validateDevelopmentAudit(audit, mitigation, lock, reviewedAt)).toBe(1);
    expect(() => validateDevelopmentAudit(audit, mitigation, lock, Date.parse(mitigation.expiresAt))).toThrow('expired');
    expect(() => validateDevelopmentAudit(audit, { ...mitigation, owner: '' }, lock, reviewedAt)).toThrow('owner');
  });
  it('rejects unknown advisories, production reachability, malformed audits and critical escalation', () => {
    for (const changed of [
      { vulnerabilities: { unrelated: entry } },
      { vulnerabilities: { braces: { ...entry, severity: 'critical' } } },
      { vulnerabilities: { braces: { ...entry, via: [{ url: 'https://example.com/new-advisory', name: 'braces' }] } } },
      { vulnerabilities: { braces: { ...entry, nodes: ['node_modules/next'] } } },
      { error: 'offline' },
    ]) expect(() => validateDevelopmentAudit(changed, mitigation, lock, reviewedAt)).toThrow();
  });
  it('reproduces application/build reachability and verifies the compatible ZIP64 patch', () => {
    expect(() => verifyDevelopmentReachability(process.cwd())).not.toThrow();
    expect(lock.packages['node_modules/satori/node_modules/fflate'].version).toBe('0.7.5');
    expect(lock.packages['node_modules/fflate'].version).toBe('0.8.3');
    expect(lock.packages['node_modules/braces'].dev).toBe(true);
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('run: npm run audit:production');
    expect(ci).toContain('run: npm run audit:development');
  });
});
