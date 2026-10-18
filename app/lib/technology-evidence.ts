type LanguageEvidence = {
  languages: Record<string, number>;
  fingerprint?: { frameworks?: string[]; languageFileCounts?: Record<string, number> };
};
const NON_SOURCE = new Set(['Configuration', 'Markdown', 'External', 'Unknown']);
function rankedWeights(values: Record<string, number>): [string, number][] {
  return Object.entries(values).filter(([name, weight]) => name.trim() && !NON_SOURCE.has(name) && Number.isFinite(weight) && weight > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'en'));
}
export function rankedLanguages(repository: LanguageEvidence): string[] {
  const shares = rankedWeights(repository.languages);
  return (shares.length ? shares : rankedWeights(repository.fingerprint?.languageFileCounts ?? {})).map(([name]) => name);
}
export function primaryTechnology(repository: LanguageEvidence): { name: string; evidence: string } {
  const shares = rankedWeights(repository.languages);
  if (shares.length) return { name: shares[0][0], evidence: `Largest recorded source-language share (${shares[0][1]}%).` };
  const counts = rankedWeights(repository.fingerprint?.languageFileCounts ?? {});
  if (counts.length) return { name: counts[0][0], evidence: `Most recorded language files (${counts[0][1]}). LOC proportions were not recorded.` };
  const frameworks = [...new Set(repository.fingerprint?.frameworks ?? [])].filter((name) => name.trim());
  if (frameworks.length === 1) return { name: frameworks[0], evidence: 'One detected framework; quantitative language evidence is unavailable.' };
  return { name: 'Custom application', evidence: 'No quantitative language evidence or single primary framework was recorded.' };
}
export function orderTechnologies(repository: LanguageEvidence, technologies: string[]): string[] {
  const present = new Set(technologies);
  const ranked = [...rankedLanguages(repository), ...(repository.fingerprint?.frameworks ?? []).slice().sort(), ...technologies.slice().sort()];
  return [...new Set(ranked)].filter((name) => present.has(name));
}
