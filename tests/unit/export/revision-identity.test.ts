import { expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { makeV2Fixture } from './fixtures';
import { projectV2ForWorkspace } from '../../../app/lib/schema/v2-viewer-projection';
import { adaptV1ToV2Viewer } from '../../../app/lib/schema/artifact-loader';
import { validateRepoDNAProject } from '../../../app/lib/schema/safe-validator';
import { normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { buildGraphJson } from '../../../app/lib/export/graph/json';
import { buildCsvBundle } from '../../../app/lib/export/graph/csv';
import { buildParquetBundle } from '../../../app/lib/export/graph/parquet';
import { buildCypher } from '../../../app/lib/export/graph/cypher';
import { generateTextReport } from '../../../app/lib/export/text-report';

it('preserves the pinned snapshot through legacy projection, adaptation and every portable format', async () => {
  const canonical = makeV2Fixture();
  const sha = canonical.repository.commitSha!;
  canonical.repository.source = `https://github.com/example/fixture-repo/tree/${sha}`;
  canonical.repository.analyzedRef = sha;
  const legacy = projectV2ForWorkspace(canonical);
  expect(validateRepoDNAProject(legacy).valid).toBe(true);
  expect(adaptV1ToV2Viewer(legacy).repository).toMatchObject({ commitSha: sha, analyzedRef: sha, source: canonical.repository.source });
  for (const artifact of [canonical, legacy]) {
    const { document } = await normalizeArtifactForExport(artifact);
    const expected = { commitSha: sha, analyzedRef: sha, source: canonical.repository.source };
    const json = JSON.parse(new TextDecoder().decode((await buildGraphJson(document)).bytes));
    expect(json.manifest.repository).toMatchObject(expected);
    for (const bundle of [await buildCsvBundle(document), await buildParquetBundle(document)]) {
      expect(JSON.parse(new TextDecoder().decode(unzipSync(bundle.bytes)['manifest.json'])).repository).toMatchObject(expected);
    }
    const cypher = new TextDecoder().decode((await buildCypher(document)).bytes);
    const encoded = cypher.match(/^\/\/ Export manifest JSON \(base64 UTF-8\): ([A-Za-z0-9+/=]+)$/m)![1];
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).repository).toMatchObject(expected);
    expect(generateTextReport(artifact)).toContain(`Analyzed commit: ${sha}`);
    expect(generateTextReport(artifact)).toContain(`Analyzed ref:    ${sha}`);
  }
  legacy.repository.commitSha = 42 as never;
  expect(validateRepoDNAProject(legacy).valid).toBe(false);
});
