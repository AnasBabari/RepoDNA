import { DEPENDENCY_SCOPES } from '../analyzer/manifest-types';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const string = (value: unknown, max = 4096) => typeof value === 'string' && value.length <= max;
const ecosystems = new Set(['npm', 'python', 'go']);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
export function checkInventoryEvidence(value: unknown, errors: string[], prefix: string): void {
  if (!record(value)) return;
  const error = (message: string) => { if (errors.length < 100) errors.push(`${prefix}.${message}`); };
  for (const field of ['packageCount', 'declaredDependencyCount']) if (field in value && value[field] !== null && !integer(value[field])) error(`${field} must be a non-negative integer or null`);
  const manifest = value.manifestInventory;
  if (manifest !== undefined) {
    if (!record(manifest)) error('manifestInventory must be an object');
    else {
      if (!only(manifest, ['status', 'packages', 'declarations', 'problems'])) error('manifestInventory contains unknown fields');
      if (!['complete', 'partial', 'unavailable'].includes(manifest.status as string)) error('manifestInventory.status is invalid');
      const arrays = [['packages', 2000], ['declarations', 50000], ['problems', 2000]] as const;
      if (manifest.status === 'unavailable' && arrays.some(([field]) => Array.isArray(manifest[field]) && manifest[field].length > 0)) error('unavailable manifest evidence must not contain observations');
      for (const [field, cap] of arrays) {
        const items = manifest[field];
        if (!Array.isArray(items) || items.length > cap) { error(`manifestInventory.${field} exceeds its array bound or is missing`); continue; }
        for (const item of items) {
          if (errors.length >= 100) break;
          if (!record(item)) { error(`manifestInventory.${field} entry must be an object`); continue; }
          if (field === 'problems') {
            if (!only(item, ['file', 'code', 'message'])) error('manifestInventory.problem contains unknown fields');
            if (!string(item.file) || !string(item.code, 128) || !string(item.message, 1024)) error('manifestInventory.problem fields are invalid');
          } else {
            if (!ecosystems.has(item.ecosystem as string) || !string(item.root)) error('manifestInventory package/declaration identity is invalid');
            if (field === 'packages') {
              if (!only(item, ['ecosystem', 'root', 'name', 'workspace', 'manifests'])) error('manifestInventory.package contains unknown fields');
              if ((item.name !== null && !string(item.name, 512)) || typeof item.workspace !== 'boolean' || !Array.isArray(item.manifests) || item.manifests.length > 2000 || !item.manifests.every((path) => string(path))) error('manifestInventory.package fields are invalid');
            } else if (!only(item, ['ecosystem', 'root', 'name', 'scope', 'group', 'file']) || !string(item.name, 512) || !DEPENDENCY_SCOPES.includes(item.scope as never) || !string(item.group, 1024) || !string(item.file)) error('manifestInventory.declaration fields are invalid');
          }
        }
      }
    }
  }
  const counts = value.sourceInventory;
  if (counts !== undefined) {
    const fields = ['totalFileCount', 'firstPartySourceFileCount', 'supportedSourceFileCount', 'unsupportedSourceFileCount', 'evidenceFileCount', 'otherFileCount', 'ignoredFileCount', 'generatedFileCount', 'candidateFileCount', 'skippedSupportedSourceFileCount'];
    if (!record(counts) || counts.classificationVersion !== 2 || fields.some((key) => !integer(counts[key]))) error('sourceInventory fields are invalid');
    else {
      if (!only(counts, ['classificationVersion', ...fields])) error('sourceInventory contains unknown fields');
      const sum = ['supportedSourceFileCount', 'unsupportedSourceFileCount', 'evidenceFileCount', 'otherFileCount', 'ignoredFileCount', 'generatedFileCount'].reduce((total, key) => total + (counts[key] as number), 0);
      if (counts.totalFileCount !== sum || counts.firstPartySourceFileCount !== (counts.supportedSourceFileCount as number) + (counts.unsupportedSourceFileCount as number)) error('sourceInventory classes do not reconcile');
      if ((counts.candidateFileCount as number) > (counts.totalFileCount as number) || (counts.skippedSupportedSourceFileCount as number) > (counts.supportedSourceFileCount as number)) error('sourceInventory subset counts exceed their populations');
    }
  }
  const outcomes = value.sourceOutcomes;
  if (outcomes !== undefined) {
    if (!record(outcomes) || ['supported', 'complete', 'partial', 'failed', 'skipped', 'unprocessed'].some((key) => !integer(outcomes[key]))) error('sourceOutcomes fields are invalid');
    else if (outcomes.supported !== (outcomes.complete as number) + (outcomes.partial as number) + (outcomes.failed as number) + (outcomes.skipped as number) + (outcomes.unprocessed as number)) error('sourceOutcomes do not reconcile');
    else if (!only(outcomes, ['supported', 'complete', 'partial', 'failed', 'skipped', 'unprocessed']) || (record(counts) && outcomes.supported !== counts.supportedSourceFileCount)) error('sourceOutcomes basis is inconsistent');
  }
}
