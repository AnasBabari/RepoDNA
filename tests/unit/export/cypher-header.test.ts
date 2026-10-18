import { describe, expect, it } from 'vitest';
import { buildCypher } from '../../../app/lib/export/graph/cypher';
import { normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { makeSecurityFixture } from './fixtures';

const payloads = [
  'repo\nRETURN 918273 AS injected; //',
  'repo\rRETURN 918273 AS injected; //',
  'repo\r\nRETURN 918273 AS injected; //',
  'repo\u0085RETURN 918273 AS injected; //',
  'repo\u2028RETURN 918273 AS injected; //',
  'repo\u2029RETURN 918273 AS injected; //',
  'repo\\u000ARETURN 918273 AS injected; //',
  'repo/* */ // \' " ` ;\u0000\u000b\u000cRETURN 918273 AS injected;',
];
const manifestFields = ['exportSchemaVersion', 'exporterVersion', 'analyzedAt'] as const;
const repositoryFields = ['name', 'source', 'commitSha', 'analyzedRef'] as const;

function executableText(text: string) {
  const code = text.split('\n').filter((line) => !line.startsWith('//')).join('\n');
  // Metadata is now also persisted as escaped DATA; compare executable shape,
  // not legitimate differing snapshot-key/manifest string values.
  let quoted = false, escaped = false, shape = '';
  for (const char of code) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === "'") quoted = false;
    } else if (char === "'") { quoted = true; shape += "''"; }
    else shape += char;
  }
  expect(quoted).toBe(false);
  return shape;
}

describe('Cypher manifest comments', () => {
  for (const field of [...manifestFields, ...repositoryFields]) {
    it(`keeps hostile ${field} metadata inert without changing graph statements`, async () => {
      const { document } = await normalizeArtifactForExport(makeSecurityFixture());
      document.manifest.repository.commitSha ??= 'a'.repeat(40);
      const baseline = new TextDecoder().decode((await buildCypher(document)).bytes);
      for (const payload of payloads) {
        const changed = structuredClone(document);
        const target = repositoryFields.some((name) => name === field) ? changed.manifest.repository : changed.manifest;
        Object.assign(target, { [field]: payload });
        const text = new TextDecoder().decode((await buildCypher(changed)).bytes);
        expect(executableText(text)).toBe(executableText(baseline));
        const header = text.slice(0, text.indexOf('CREATE CONSTRAINT'));
        expect(header).not.toMatch(/[\r\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\\]/);
        expect(header.split('\n').every((line) => line === '' || line.startsWith('//'))).toBe(true);
      }
    });
  }

  it('still rejects an invalid source digest before serialization', async () => {
    const { document } = await normalizeArtifactForExport(makeSecurityFixture());
    document.manifest.sourceArtifactSha256 = 'digest\nRETURN 918273 AS injected;';
    await expect(buildCypher(document)).rejects.toThrow('validation');
  });
});
