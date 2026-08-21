import type {
  ArchitectureComponent,
  ArchitectureConnection,
  CallRecord,
  Diagnostic,
  EntrypointRecord,
  FileRecord,
  FlowRecord,
  ImportRecord,
  RepoDNAProject,
  RouteRecord,
  SymbolRecord,
  TechnologyBoundary,
} from '../types';

export interface DiscoveredFile {
  path: string;
  size: number;
  content: string;
  hash: string;
}

export interface PartialAnalysis {
  file: FileRecord;
  symbols: SymbolRecord[];
  imports: ImportRecord[];
  calls: CallRecord[];
  routes: RouteRecord[];
  frameworks: Set<string>;
  databases: Set<string>;
  externals: Set<string>;
  entrypointEvidence: string[];
}

export type {
  ArchitectureComponent,
  ArchitectureConnection,
  CallRecord,
  Diagnostic,
  EntrypointRecord,
  FileRecord,
  FlowRecord,
  ImportRecord,
  RepoDNAProject,
  RouteRecord,
  SymbolRecord,
  TechnologyBoundary,
};
