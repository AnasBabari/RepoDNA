import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { auditArchitectureConsistency } from '../../app/lib/analysis-lifecycle';
import { adaptV1ToV2Viewer } from '../../app/lib/schema/artifact-loader';
import { projectV2ForWorkspace } from '../../app/lib/schema/v2-viewer-projection';
import type { RepoDNAProject } from '../../app/lib/types';

function loadStrixFixture(): RepoDNAProject {
  return JSON.parse(readFileSync('public/samples/strix.json', 'utf8')) as RepoDNAProject;
}

describe('v2 semantic graph adapter', () => {
  it('preserves files, symbols, routes, models, calls, and external dependencies', () => {
    const v1 = loadStrixFixture();
    const v2 = adaptV1ToV2Viewer(v1);

    expect(v2.nodes.filter((node) => node.kind === 'file')).toHaveLength(v1.files.length);
    expect(v2.nodes.filter((node) => node.kind === 'route')).toHaveLength(v1.routes.length);
    expect(v2.nodes.some((node) => node.kind === 'class')).toBe(true);
    expect(v2.nodes.some((node) => node.kind === 'method')).toBe(true);
    expect(v2.nodes.some((node) => node.kind === 'data_model')).toBe(true);
    expect(v2.nodes.some((node) => node.kind === 'dependency' && node.name === 'fastapi')).toBe(true);

    expect(v2.edges.some((edge) => edge.type === 'DEFINES')).toBe(true);
    expect(v2.edges.some((edge) => edge.type === 'CALLS' && edge.status === 'resolved')).toBe(true);
    expect(v2.edges.some((edge) => edge.type === 'EXPOSES_ROUTE')).toBe(true);
    expect(v2.edges.some((edge) => edge.type === 'HANDLES' && edge.status === 'resolved')).toBe(true);
    expect(v2.edges.some((edge) => edge.type === 'DEPENDS_ON')).toBe(true);
  });

  it('round-trips into a consistent legacy workspace projection', () => {
    const v1 = loadStrixFixture();
    const v2 = adaptV1ToV2Viewer(v1);
    const viewer = projectV2ForWorkspace(v2);
    const audit = auditArchitectureConsistency(viewer);

    expect(audit.issues).toEqual([]);
    expect(viewer.files).toHaveLength(v1.files.length);
    expect(viewer.symbols).toHaveLength(v1.symbols.length);
    expect(viewer.routes).toHaveLength(v1.routes.length);
    expect(viewer.calls).toHaveLength(v1.calls.length);
    expect(viewer.imports).toHaveLength(v1.imports.length);
  });
});
