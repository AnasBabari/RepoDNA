import { expect, it } from 'vitest';
import { primaryTechnology, orderTechnologies } from '../../app/lib/technology-evidence';
import { projectV2ForWorkspace } from '../../app/lib/schema/v2-viewer-projection';
import { makeV2Fixture } from './export/fixtures';

it('uses measured language proportions rather than alphabetical technology or key order', () => {
  const repo = { languages: { CSS: 0.1, HTML: 0.3, Python: 99.6 }, fingerprint: { frameworks: [] } };
  expect(primaryTechnology(repo)).toEqual({ name: 'Python', evidence: 'Largest recorded source-language share (99.6%).' });
  expect(orderTechnologies(repo, ['CSS', 'Python', 'HTML'])).toEqual(['Python', 'HTML', 'CSS']);
});
it('keeps source-language and framework evidence distinct', () => {
  const repo = { languages: { JavaScript: 20, TypeScript: 80 }, fingerprint: { frameworks: ['React', 'Next.js'] } };
  expect(primaryTechnology(repo).name).toBe('TypeScript');
  expect(orderTechnologies(repo, ['React', 'CSS', 'Next.js', 'JavaScript', 'TypeScript'])).toEqual(['TypeScript', 'JavaScript', 'Next.js', 'React', 'CSS']);
});
it('handles missing, tied, non-source and invalid weights without inventing a winning language', () => {
  expect(primaryTechnology({ languages: { CSS: NaN, Python: -1, Configuration: 100 }, fingerprint: { languageFileCounts: { Python: 37, CSS: 1 } } }).name).toBe('Python');
  expect(primaryTechnology({ languages: { TypeScript: 50, Python: 50 } }).name).toBe('Python');
  expect(primaryTechnology({ languages: {}, fingerprint: { frameworks: ['FastAPI'] } }).name).toBe('FastAPI');
  expect(primaryTechnology({ languages: {}, fingerprint: { frameworks: ['React', 'FastAPI'] } }).name).toBe('Custom application');
});
it('does not alter canonical language evidence while projecting a legacy workspace', () => {
  const project = makeV2Fixture();
  project.repository.languages = { CSS: 0.1, HTML: 0.3, Python: 99.6 };
  project.repository.fingerprint.languages = ['CSS', 'HTML', 'Python'];
  const original = structuredClone(project.repository);
  expect(projectV2ForWorkspace(project).technologies.slice(0, 3)).toEqual(['Python', 'HTML', 'CSS']);
  expect(project.repository).toEqual(original);
});
