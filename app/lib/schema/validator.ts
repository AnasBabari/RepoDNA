import type { RepoDNAProject } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates whether an arbitrary JSON object strictly conforms to the canonical RepoDNA schema.
 */
export function validateRepoDNAProject(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Analysis payload must be a non-null object.'] };
  }

  const project = data as Partial<RepoDNAProject>;

  // 1. Schema version
  if (typeof project.schemaVersion !== 'string' || !project.schemaVersion.trim()) {
    errors.push('Missing or invalid "schemaVersion" (must be string).');
  }

  // 2. Repository metadata
  if (!project.repository || typeof project.repository !== 'object') {
    errors.push('Missing or invalid "repository" object.');
  } else {
    const repo = project.repository;
    if (typeof repo.name !== 'string') errors.push('repository.name must be a string.');
    if (typeof repo.source !== 'string') errors.push('repository.source must be a string.');
    if (typeof repo.fileCount !== 'number' || repo.fileCount < 0) errors.push('repository.fileCount must be a non-negative number.');
    if (!repo.fingerprint || typeof repo.fingerprint !== 'object') {
      errors.push('repository.fingerprint object is required.');
    } else {
      if (!Array.isArray(repo.fingerprint.languages)) errors.push('repository.fingerprint.languages must be an array.');
      if (!Array.isArray(repo.fingerprint.frameworks)) errors.push('repository.fingerprint.frameworks must be an array.');
      if (!Array.isArray(repo.fingerprint.databases)) errors.push('repository.fingerprint.databases must be an array.');
    }
  }

  // 3. Core collections
  if (!Array.isArray(project.technologies)) errors.push('"technologies" must be an array.');
  if (!Array.isArray(project.files)) errors.push('"files" must be an array.');
  if (!Array.isArray(project.symbols)) errors.push('"symbols" must be an array.');
  if (!Array.isArray(project.imports)) errors.push('"imports" must be an array.');
  if (!Array.isArray(project.calls)) errors.push('"calls" must be an array.');
  if (!Array.isArray(project.routes)) errors.push('"routes" must be an array.');
  if (!Array.isArray(project.databases)) errors.push('"databases" must be an array.');
  if (!Array.isArray(project.entrypoints)) errors.push('"entrypoints" must be an array.');
  if (!Array.isArray(project.flows)) errors.push('"flows" must be an array.');

  // 4. Architecture
  if (!project.architecture || typeof project.architecture !== 'object') {
    errors.push('"architecture" object is required.');
  } else {
    if (!Array.isArray(project.architecture.components)) errors.push('architecture.components must be an array.');
    if (!Array.isArray(project.architecture.connections)) errors.push('architecture.connections must be an array.');
  }

  // 5. Metrics
  if (!project.metrics || typeof project.metrics !== 'object') {
    errors.push('"metrics" object is required.');
  } else {
    const metrics = project.metrics;
    if (typeof metrics.complexityScore !== 'number') errors.push('metrics.complexityScore must be a number.');
    if (typeof metrics.symbols !== 'number') errors.push('metrics.symbols must be a number.');
    if (typeof metrics.routes !== 'number') errors.push('metrics.routes must be a number.');
    if (typeof metrics.components !== 'number') errors.push('metrics.components must be a number.');
    if (typeof metrics.parseSuccessRate !== 'number') errors.push('metrics.parseSuccessRate must be a number.');
  }

  // 6. Diagnostics & Metadata
  if (!Array.isArray(project.diagnostics)) errors.push('"diagnostics" must be an array.');
  if (!project.metadata || typeof project.metadata !== 'object') {
    errors.push('"metadata" object is required.');
  } else {
    if (typeof project.metadata.analysisMode !== 'string') errors.push('metadata.analysisMode must be a string.');
    if (typeof project.metadata.executedRepositoryCode !== 'boolean') errors.push('metadata.executedRepositoryCode must be a boolean.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Asserts that the data conforms to RepoDNAProject schema, throwing an Error if invalid.
 */
export function assertRepoDNAProject(data: unknown): asserts data is RepoDNAProject {
  const result = validateRepoDNAProject(data);
  if (!result.valid) {
    throw new Error(`Schema validation failed: ${result.errors.join('; ')}`);
  }
}
