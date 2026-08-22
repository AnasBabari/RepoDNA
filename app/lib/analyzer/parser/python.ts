import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getTreeSitterParser } from './runtime';
import {
  type ParseInput,
  type ParsedSyntax,
  type SourceRange,
  type SupportedLanguage,
  type SyntaxCall,
  type SyntaxDecorator,
  type SyntaxFacts,
  type SyntaxImport,
  type SyntaxParser,
  type SyntaxSymbol,
} from './types';

const MAIN_GUARD_RE = /__name__\s*(?:==|is)\s*["']__main__["']/;

interface WalkState {
  symbols: SyntaxSymbol[];
  imports: SyntaxImport[];
  calls: SyntaxCall[];
  errorNodes: number;
  hasMainGuard: boolean;
}

interface Frame {
  qualifiedName: string;
  kind: 'class' | 'callable';
}

export class PythonSyntaxParser implements SyntaxParser {
  language: SupportedLanguage = 'python';
  extensions = ['.py', '.pyi'] as const;

  async initialise(): Promise<void> {
    await getTreeSitterParser(this.language);
  }

  async parse(input: ParseInput): Promise<ParsedSyntax> {
    const parser = await getTreeSitterParser(this.language);

    let root: SyntaxNode | null = null;
    try {
      const tree = parser.parse(input.source);
      root = tree?.rootNode ?? null;
    } catch {
      root = null;
    }

    if (!root) {
      return { facts: failedFacts() };
    }

    const state: WalkState = {
      symbols: [],
      imports: [],
      calls: [],
      errorNodes: 0,
      hasMainGuard: false,
    };

    for (const child of root.namedChildren) {
      walk(child, state, [], [], null);
    }

    const hasErrors = state.errorNodes > 0 || root.hasError;
    const quality = hasErrors ? 'partial' : 'complete';

    const facts: SyntaxFacts = {
      language: 'python',
      symbols: state.symbols,
      imports: state.imports,
      calls: state.calls,
      hasMainGuard: state.hasMainGuard,
      parse: { success: true, hasErrors, errorNodes: state.errorNodes },
      quality,
    };
    return { facts };
  }
}

function failedFacts(): SyntaxFacts {
  return {
    language: 'python',
    symbols: [],
    imports: [],
    calls: [],
    hasMainGuard: false,
    parse: { success: false, hasErrors: true, errorNodes: 0 },
    quality: 'failed',
  };
}

function walk(
  node: SyntaxNode,
  state: WalkState,
  stack: Frame[],
  decorators: SyntaxDecorator[],
  assignmentTarget: string | null
): void {
  if (node.isError || node.isMissing) state.errorNodes += 1;

  switch (node.type) {
    case 'decorated_definition': {
      const collected = [...decorators];
      const definition = node.childForFieldName('definition');
      for (const child of node.namedChildren) {
        if (child.type === 'decorator') {
          const extracted = extractDecorator(child);
          if (extracted) collected.push(extracted);
        }
      }
      if (definition) walk(definition, state, stack, collected, assignmentTarget);
      return;
    }

    case 'class_definition':
    case 'function_definition': {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const parentFrame = stack.length ? stack[stack.length - 1] : null;
      const isClass = node.type === 'class_definition';
      const kind = isClass ? 'class' : parentFrame?.kind === 'class' ? 'method' : 'function';
      const qualifiedName = parentFrame ? `${parentFrame.qualifiedName}::${name}` : name;

      const symbol: SyntaxSymbol = {
        kind,
        name,
        qualifiedName,
        range: rangeOf(node),
        parent: parentFrame ? parentFrame.qualifiedName : null,
        exported: true,
        isAsync: node.children.some((child) => child.type === 'async'),
        bases: isClass ? extractSuperclasses(node) : [],
        decorators,
      };
      state.symbols.push(symbol);

      stack.push({ qualifiedName, kind: isClass ? 'class' : 'callable' });
      for (const child of node.namedChildren) {
        walk(child, state, stack, [], null);
      }
      stack.pop();
      return;
    }

    case 'import_statement': {
      state.imports.push(...extractPlainImports(node));
      return;
    }

    case 'import_from_statement': {
      const extracted = extractFromImport(node);
      if (extracted) state.imports.push(extracted);
      return;
    }

    case 'assignment': {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      const target = left && left.type === 'identifier' ? left.text : null;
      for (const child of node.namedChildren) {
        const isRight = right !== null && child.id === right.id;
        walk(child, state, stack, [], isRight ? target : assignmentTarget);
      }
      return;
    }

    case 'call': {
      const fn = node.childForFieldName('function');
      if (fn && (fn.type === 'identifier' || fn.type === 'attribute')) {
        const args = node.childForFieldName('arguments');
        state.calls.push({
          callee: fn.text,
          receiver: fn.type === 'attribute' ? fn.childForFieldName('object')?.text ?? null : null,
          argumentsText: args ? args.text.slice(1, -1) : null,
          assignedTo: assignmentTarget,
          argumentCount: args ? args.namedChildren.length : 0,
          ownerQualifiedName: stack.length ? stack[stack.length - 1].qualifiedName : null,
          range: rangeOf(node),
        });
      }
      break;
    }

    case 'if_statement': {
      const condition = node.childForFieldName('condition');
      if (condition && MAIN_GUARD_RE.test(condition.text)) {
        state.hasMainGuard = true;
      }
      break;
    }

    default:
      break;
  }

  for (const child of node.namedChildren) {
    walk(child, state, stack, [], null);
  }
}

function rangeOf(node: SyntaxNode): SourceRange {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  };
}

function extractSuperclasses(node: SyntaxNode): string[] {
  const superclasses = node.childForFieldName('superclasses');
  if (!superclasses) return [];
  return superclasses.namedChildren
    .filter((child) => child.type === 'identifier' || child.type === 'attribute')
    .map((child) => child.text);
}

function extractDecorator(node: SyntaxNode): SyntaxDecorator | null {
  const expression = node.namedChildren[0];
  if (!expression) return null;

  if (expression.type === 'call') {
    const fn = expression.childForFieldName('function');
    const args = expression.childForFieldName('arguments');
    if (!fn || (fn.type !== 'identifier' && fn.type !== 'attribute')) return null;
    return {
      name: fn.text,
      argumentsText: args ? args.text.slice(1, -1) : '',
      range: rangeOf(node),
    };
  }

  if (expression.type === 'identifier' || expression.type === 'attribute') {
    return { name: expression.text, argumentsText: null, range: rangeOf(node) };
  }

  return null;
}

function extractPlainImports(node: SyntaxNode): SyntaxImport[] {
  const results: SyntaxImport[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'dotted_name') {
      results.push({
        module: child.text,
        names: [child.text],
        aliases: {},
        relativeLevel: 0,
        isWildcard: false,
        range: rangeOf(child),
      });
    } else if (child.type === 'aliased_import') {
      const original = child.childForFieldName('name');
      const alias = child.childForFieldName('alias');
      if (!original) continue;
      results.push({
        module: original.text,
        names: [original.text],
        aliases: alias ? { [original.text]: alias.text } : {},
        relativeLevel: 0,
        isWildcard: false,
        range: rangeOf(child),
      });
    }
  }
  return results;
}

function extractFromImport(node: SyntaxNode): SyntaxImport | null {
  const moduleNode = node.namedChildren.find(
    (child) => child.type === 'dotted_name' || child.type === 'relative_import'
  );
  if (!moduleNode) return null;

  let moduleName = moduleNode.text;
  let relativeLevel = 0;

  if (moduleNode.type === 'relative_import') {
    const prefix = moduleNode.children.find((child) => child.type === 'import_prefix');
    const dotted = moduleNode.children.find((child) => child.type === 'dotted_name');
    relativeLevel = prefix ? countDots(prefix.text) : 1;
    moduleName = `${'.'.repeat(relativeLevel)}${dotted ? dotted.text : ''}`;
  }

  const names: string[] = [];
  const aliases: Record<string, string> = {};
  let isWildcard = false;

  for (const child of node.namedChildren) {
    if (child.id === moduleNode.id) continue;
    if (child.type === 'dotted_name') {
      names.push(child.text);
    } else if (child.type === 'aliased_import') {
      const original = child.childForFieldName('name');
      const alias = child.childForFieldName('alias');
      if (!original) continue;
      names.push(original.text);
      if (alias) aliases[original.text] = alias.text;
    } else if (child.type === 'wildcard_import') {
      isWildcard = true;
    }
  }

  return { module: moduleName, names, aliases, relativeLevel, isWildcard, range: rangeOf(node) };
}

function countDots(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === '.') count += 1;
  }
  return Math.max(count, 1);
}
