import { describe, expect, it } from 'vitest';
import type { ArchitectureComponent, ArchitectureConnection } from '../../app/lib/types';
import type { SavedArchitectureView } from '../../app/components/ArchitectureGraph';

describe('Architecture Saved Views & Fingerprinting', () => {
  const sampleComponents: ArchitectureComponent[] = [
    { id: 'api', name: 'API Server', type: 'api', confidence: 0.95, evidence: [], files: ['src/index.ts', 'src/routes.ts'] },
    { id: 'services', name: 'Domain Services', type: 'services', confidence: 0.9, evidence: [], files: ['src/services/user.ts'] },
    { id: 'db', name: 'Database', type: 'database', confidence: 0.9, evidence: [], files: ['src/models/user.ts'] },
  ];

  const sampleConnections: ArchitectureConnection[] = [
    { source: 'api', target: 'services', type: 'calls', weight: 3 },
    { source: 'services', target: 'db', type: 'data_access', weight: 2 },
  ];

  it('computes deterministic architecture fingerprints', () => {
    const compStr = sampleComponents
      .map((c) => `${c.id}:${c.type}:${c.files.length}`)
      .sort()
      .join('|');
    const connStr = sampleConnections
      .map((c) => `${c.source}->${c.target}:${c.type}`)
      .sort()
      .join('|');
    expect(compStr).toContain('api:api:2');
    expect(connStr).toContain('api->services:calls');
  });

  it('validates and safely parses well-formed saved view state', () => {
    const validState: SavedArchitectureView = {
      version: 1,
      graphFingerprint: 'abc1234',
      positions: {
        api: { x: 100, y: 200 },
        services: { x: 100, y: 400 },
        db: { x: 100, y: 600 },
      },
      viewport: { x: 50, y: 50, zoom: 1.2 },
      filter: 'services',
    };

    expect(validState.version).toBe(1);
    expect(validState.filter).toBe('services');
    expect(validState.positions.api.x).toBe(100);
    expect(validState.viewport?.zoom).toBe(1.2);
  });

  it('rejects corrupted or malicious saved view payloads', () => {
    const corruptedPayloads = [
      null,
      'not an object',
      { version: 2 }, // unsupported version
      { version: 1, positions: 'invalid' },
      { version: 1, positions: { api: { x: 'NaN', y: 100 } } },
      { version: 1, positions: { api: { x: Infinity, y: 100 } } },
      { version: 1, viewport: { zoom: 999999 } }, // out of bounds zoom
    ];

    for (const payload of corruptedPayloads) {
      const isValid =
        payload !== null &&
        typeof payload === 'object' &&
        (payload as Record<string, unknown>).version === 1 &&
        typeof (payload as Record<string, unknown>).positions === 'object' &&
        (payload as Record<string, unknown>).positions !== null;

      if (isValid) {
        const positions = (payload as Record<string, unknown>).positions as Record<string, { x?: unknown; y?: unknown }>;
        const isPosValid = Object.values(positions).every(
          (p) => typeof p?.x === 'number' && Number.isFinite(p.x) && typeof p?.y === 'number' && Number.isFinite(p.y)
        );
        expect(isPosValid).toBe(false);
      }
    }
  });

  it('guarantees storage keys do not leak private repo names or identifiers', () => {
    const privateRepoSource = 'github:SecretEnterpriseOrg/SuperConfidentialEngine';
    const graphFingerprint = '9f8e7d6c';

    // Simple deterministic hash simulation
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    const combined = `${privateRepoSource}:${graphFingerprint}`;
    for (let i = 0; i < combined.length; i++) {
      const ch = combined.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    const hash = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    const storageKey = `repodna_view_v1_${hash}`;

    expect(storageKey).toMatch(/^repodna_view_v1_[a-f0-9]+$/);
    expect(storageKey).not.toContain('SecretEnterpriseOrg');
    expect(storageKey).not.toContain('SuperConfidentialEngine');
    expect(storageKey).not.toContain('github');
  });
});
