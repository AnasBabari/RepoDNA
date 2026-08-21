export type Evidence = { description?: string; file?: string; line?: number; kind?: string };

export type FileRecord = {
  id: string;
  path: string;
  language: string;
  lines: number;
  bytes: number;
  hash: string;
  role: string;
  parsed: boolean;
  error: string | null;
};

export type SymbolRecord = {
  id: string;
  type: string;
  name: string;
  file: string;
  line: number;
  end_line: number | null;
  parent: string | null;
  exported: boolean;
  evidence: string[];
};

export type ImportRecord = {
  id: string;
  source: string;
  module: string;
  names: string[];
  line: number;
  target: string | null;
  external: boolean;
};

export type CallRecord = {
  id: string;
  source: string;
  callee: string;
  file: string;
  line: number;
  target: string | null;
  confidence: number;
};

export type RouteRecord = {
  id: string;
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
  framework: string;
  confidence: number;
};

export type EntrypointRecord = {
  id: string;
  file: string;
  kind: string;
  score: number;
  confidence: number;
  evidence: string[];
};

export type ArchitectureComponent = {
  id: string;
  name: string;
  type: string;
  files: string[];
  confidence: number;
  evidence: string[];
};

export type ArchitectureConnection = {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
};

export type FlowNode = {
  id: string;
  type: string;
  label: string;
  file: string;
  line: number;
};

export type FlowRecord = {
  id: string;
  name: string;
  confidence: number;
  nodes: FlowNode[];
  edges: { source: string; target: string; type: string }[];
};

export type TechnologyBoundary = {
  name: string;
  type: string;
  confidence: number;
  evidence: Evidence[];
};

export type ImportantFile = { file: string; score: number; reasons: string[] };
export type OnboardingStep = { step: number; title: string; file: string; description: string };
export type Diagnostic = { severity: 'info' | 'warning'; code: string; message: string; file: string | null };

export type RepoDNAProject = {
  schemaVersion: string;
  generatedAt: string;
  repository: {
    name: string;
    source: string;
    languages: Record<string, number>;
    fileCount: number;
    sourceFileCount: number;
    parsedFileCount: number;
    lines: number;
    fingerprint: {
      languages: string[];
      frameworks: string[];
      infrastructure: string[];
      databases: string[];
      externalSystems: string[];
      testing: string[];
      buildTools: string[];
    };
  };
  technologies: string[];
  files: FileRecord[];
  symbols: SymbolRecord[];
  imports: ImportRecord[];
  calls: CallRecord[];
  routes: RouteRecord[];
  databases: TechnologyBoundary[];
  external_systems: TechnologyBoundary[];
  entrypoints: EntrypointRecord[];
  flows: FlowRecord[];
  architecture: {
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
  };
  important_files: ImportantFile[];
  onboarding: OnboardingStep[];
  metrics: {
    complexityScore: number;
    localDependencies: number;
    externalDependencies: number;
    dependencyCycles: string[][];
    mostConnectedFiles: { file: string; connections: number }[];
    highCouplingFiles: { file: string; connections: number }[];
    symbols: number;
    routes: number;
    components: number;
    parseSuccessRate: number;
  };
  diagnostics: Diagnostic[];
  metadata: {
    analysisMode: string;
    executedRepositoryCode: boolean;
    limits: { maxFiles: number; maxFileBytes: number };
    fileComponents: Record<string, string>;
  };
};

