export type SupportedLanguage = 'python' | 'javascript' | 'typescript' | 'tsx' | 'go';

export type ParseQuality = 'complete' | 'partial' | 'failed';

export type ExtractionLimitCategory = 'symbols' | 'imports' | 'calls' | 'ast_nodes' | 'ast_depth';

export interface ExtractionLimit {
  category: ExtractionLimitCategory;
  limit: number;
  /** Observed omitted facts, or unknown when a traversal subtree was not visited. */
  omittedCount: number | null;
  countIsLowerBound: boolean;
  range: SourceRange;
}

export type SourceExtractionLimit = ExtractionLimit & { file: string };

export type ParserErrorCode =
  | 'TREE_SITTER_INIT_FAILED'
  | 'TREE_SITTER_GRAMMAR_LOAD_FAILED'
  | 'SOURCE_PARSE_PARTIAL'
  | 'SOURCE_PARSE_FAILED'
  | 'UNSUPPORTED_LANGUAGE';

export class ParserError extends Error {
  readonly code: ParserErrorCode;

  constructor(code: ParserErrorCode, message: string) {
    super(message);
    this.name = 'ParserError';
    this.code = code;
  }
}

export interface SourceRange {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

export type SyntaxSymbolKind = 'module' | 'function' | 'method' | 'class' | 'interface' | 'type' | 'variable' | 'attribute' | 'component';

export interface SyntaxDecorator {
  name: string;
  argumentsText: string | null;
  range: SourceRange;
}

export interface SyntaxSymbol {
  kind: SyntaxSymbolKind;
  name: string;
  qualifiedName: string;
  range: SourceRange;
  parent: string | null;
  exported: boolean;
  isAsync: boolean;
  bases: string[];
  decorators: SyntaxDecorator[];
}

export interface SyntaxImport {
  module: string;
  names: string[];
  aliases: Record<string, string>;
  relativeLevel: number;
  isWildcard: boolean;
  range: SourceRange;
}

export interface SyntaxCall {
  callee: string;
  receiver: string | null;
  argumentsText: string | null;
  assignedTo: string | null;
  argumentCount: number;
  ownerQualifiedName: string | null;
  range: SourceRange;
}

export interface ParseStats {
  success: boolean;
  hasErrors: boolean;
  errorNodes: number;
}

export interface SyntaxFacts {
  language: SupportedLanguage;
  symbols: SyntaxSymbol[];
  imports: SyntaxImport[];
  calls: SyntaxCall[];
  hasMainGuard: boolean;
  parse: ParseStats;
  quality: ParseQuality;
  extractionLimits?: ExtractionLimit[];
}

export interface ParseInput {
  source: string;
}

export interface ParsedSyntax {
  facts: SyntaxFacts;
}

export interface SyntaxParser {
  language: SupportedLanguage;
  extensions: readonly string[];
  initialise(): Promise<void>;
  parse(input: ParseInput): Promise<ParsedSyntax>;
}
