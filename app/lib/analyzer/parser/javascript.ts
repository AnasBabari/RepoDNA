import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getTreeSitterParser } from './runtime';
import type {
  ParseInput,
  ParsedSyntax,
  SourceRange,
  SupportedLanguage,
  SyntaxCall,
  SyntaxDecorator,
  SyntaxFacts,
  SyntaxImport,
  SyntaxParser,
  SyntaxSymbol,
} from './types';

const MAX_AST_NODES = 25000;
const MAX_AST_DEPTH = 128;
const MAX_SYMBOLS_PER_FILE = 1000;
const MAX_IMPORTS_PER_FILE = 500;
const MAX_CALLS_PER_FILE = 2000;

interface WalkState {
  symbols: SyntaxSymbol[];
  imports: SyntaxImport[];
  calls: SyntaxCall[];
  errorNodes: number;
  nodeCount: number;
}

interface Frame {
  qualifiedName: string;
  kind: 'class' | 'callable';
}

export class JavaScriptSyntaxParser implements SyntaxParser {
  language: SupportedLanguage = 'javascript';
  extensions = ['.js', '.jsx', '.mjs', '.cjs'] as const;

  async initialise(): Promise<void> {
    await getTreeSitterParser(this.language);
  }

  async parse(input: ParseInput): Promise<ParsedSyntax> {
    const parser = await getTreeSitterParser(this.language);
    let tree: import('web-tree-sitter').Tree | null = null;
    try {
      tree = parser.parse(input.source);
      const root = tree?.rootNode ?? null;
      if (!root) return { facts: failedFacts('javascript') };

      const state: WalkState = {
        symbols: [],
        imports: [],
        calls: [],
        errorNodes: 0,
        nodeCount: 0,
      };

      for (const child of root.namedChildren) {
        walk(child, state, [], [], 1, input.source);
      }

      const hasErrors = state.errorNodes > 0 || root.hasError;
      const quality = hasErrors ? 'partial' as const : 'complete' as const;

      return {
        facts: {
          language: 'javascript',
          symbols: state.symbols,
          imports: state.imports,
          calls: state.calls,
          hasMainGuard: false,
          parse: { success: true, hasErrors, errorNodes: state.errorNodes },
          quality,
        },
      };
    } catch {
      return { facts: failedFacts('javascript') };
    } finally {
      if (tree) {
        try {
          tree.delete();
        } catch {}
      }
    }
  }
}

function failedFacts(lang: SupportedLanguage): SyntaxFacts {
  return {
    language: lang,
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
  depth: number,
  source: string
): void {
  state.nodeCount += 1;
  if (state.nodeCount > MAX_AST_NODES || depth > MAX_AST_DEPTH) {
    state.errorNodes += 1;
    return;
  }
  if ((node as unknown as { isError?: boolean }).isError || (node as unknown as { isMissing?: boolean }).isMissing) {
    state.errorNodes += 1;
  }

  switch (node.type) {
    case 'import_statement': {
      if (state.imports.length < MAX_IMPORTS_PER_FILE) {
        const imp = extractImport(node);
        if (imp) state.imports.push(imp);
      }
      return;
    }
    case 'export_statement': {
      // Handle export: walk its declaration
      for (const child of node.namedChildren) {
        walk(child, state, stack, decorators, depth + 1, source);
      }
      return;
    }
    case 'class_declaration': {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const parent = stack.length ? stack[stack.length - 1] : null;
      const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : name;
      if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
        state.symbols.push({
          kind: 'class',
          name,
          qualifiedName,
          range: rangeOf(node),
          parent: parent ? parent.qualifiedName : null,
          exported: isExported(node),
          isAsync: false,
          bases: extractHeritage(node),
          decorators,
        });
      }
      stack.push({ qualifiedName, kind: 'class' });
      for (const child of node.namedChildren) walk(child, state, stack, [], depth + 1, source);
      stack.pop();
      return;
    }
    case 'interface_declaration': {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const parent = stack.length ? stack[stack.length - 1] : null;
      const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : name;
      if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
        state.symbols.push({
          kind: 'interface',
          name,
          qualifiedName,
          range: rangeOf(node),
          parent: parent ? parent.qualifiedName : null,
          exported: isExported(node),
          isAsync: false,
          bases: extractHeritage(node),
          decorators,
        });
      }
      // Interfaces walk children but not push callable stack
      for (const child of node.namedChildren) walk(child, state, stack, [], depth + 1, source);
      return;
    }
    case 'type_alias_declaration': {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const parent = stack.length ? stack[stack.length - 1] : null;
      const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : name;
      if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
        state.symbols.push({
          kind: 'type',
          name,
          qualifiedName,
          range: rangeOf(node),
          parent: parent ? parent.qualifiedName : null,
          exported: isExported(node),
          isAsync: false,
          bases: [],
          decorators,
        });
      }
      return;
    }
    case 'function_declaration':
    case 'function':
    case 'generator_function_declaration': {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const parent = stack.length ? stack[stack.length - 1] : null;
      const kind = parent?.kind === 'class' ? 'method' : 'function';
      const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : name;
      if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
        state.symbols.push({
          kind,
          name,
          qualifiedName,
          range: rangeOf(node),
          parent: parent ? parent.qualifiedName : null,
          exported: isExported(node),
          isAsync: node.text.startsWith('async'),
          bases: [],
          decorators,
        });
      }
      stack.push({ qualifiedName, kind: 'callable' });
      for (const child of node.namedChildren) walk(child, state, stack, [], depth + 1, source);
      stack.pop();
      return;
    }
    case 'method_definition': {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const parent = stack.length ? stack[stack.length - 1] : null;
      const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : name;
      if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
        state.symbols.push({
          kind: 'method',
          name,
          qualifiedName,
          range: rangeOf(node),
          parent: parent ? parent.qualifiedName : null,
          exported: false,
          isAsync: node.text.trimStart().startsWith('async'),
          bases: [],
          decorators: extractMethodDecorators(node),
        });
      }
      stack.push({ qualifiedName, kind: 'callable' });
      for (const child of node.namedChildren) walk(child, state, stack, [], depth + 1, source);
      stack.pop();
      return;
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const child of node.namedChildren) {
        // variable_declarator
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          const valueNode = child.childForFieldName('value');
          const name = nameNode?.text ?? null;
          if (!name) continue;
          // Handle CommonJS require imports before symbol handling (for mount resolution)
          const isRequireCall = valueNode?.type === 'call_expression' && valueNode.childForFieldName('function')?.text === 'require';
          if (isRequireCall && state.imports.length < MAX_IMPORTS_PER_FILE) {
            const argsNode = valueNode.childForFieldName('arguments');
            const modArg = argsNode?.namedChildren[0];
            let mod = modArg?.text ? modArg.text.replace(/^["']|["']$/g, '') : null;
            if (!mod) {
              const m = child.text.match(/require\s*\(\s*["']([^"']+)["']\s*\)/);
              mod = m?.[1] ?? null;
            }
            if (mod) {
              const declText = child.text;
              const destructured = declText.match(/\{\s*([^}]+)\s*\}/);
              if (destructured) {
                const names = destructured[1].split(',').map((p) => p.trim().split(/\s*:\s*/).at(-1)!.trim().split(/\s+as\s+/).at(-1)!.trim()).filter(Boolean);
                state.imports.push({ module: mod, names, aliases: {}, relativeLevel: mod.startsWith('.') ? (mod.match(/\.\.\//g) || []).length + (mod.startsWith('./') ? 1 : 0) : 0, isWildcard: false, range: rangeOf(valueNode) });
              } else {
                const singleName = name && !name.includes('{') && !name.includes('}') ? name : mod.split('/').pop()!;
                state.imports.push({ module: mod, names: [singleName], aliases: {}, relativeLevel: mod.startsWith('.') ? (mod.match(/\.\.\//g) || []).length + (mod.startsWith('./') ? 1 : 0) : 0, isWildcard: false, range: rangeOf(valueNode) });
              }
            }
            // Still walk the declarator for completeness but skip variable-symbol creation for pure require
            walk(child, state, stack, [], depth + 1, source);
            continue;
          }
          const isArrow = valueNode?.type === 'arrow_function';
          const isFuncExpr = valueNode?.type === 'function_expression' || valueNode?.type === 'function';
          if (isArrow || isFuncExpr) {
            const parent = stack.length ? stack[stack.length - 1] : null;
            const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : name;
            const isComponent = /[A-Z]/.test(name[0]) && (valueNode?.text.includes('jsx') || valueNode?.text.includes('React'));
            if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
              state.symbols.push({
                kind: isComponent ? 'component' : 'function',
                name,
                qualifiedName,
                range: rangeOf(child),
                parent: parent ? parent.qualifiedName : null,
                exported: isExported(node),
                isAsync: valueNode?.text.includes('async') ?? false,
                bases: [],
                decorators: [],
              });
            }
            if (valueNode) {
              stack.push({ qualifiedName, kind: 'callable' });
              walk(valueNode, state, stack, [], depth + 1, source);
              stack.pop();
              continue;
            }
          } else {
            // variable
            if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
              const parent = stack.length ? stack[stack.length - 1] : null;
              const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : name;
              state.symbols.push({
                kind: 'variable',
                name,
                qualifiedName,
                range: rangeOf(child),
                parent: parent ? parent.qualifiedName : null,
                exported: isExported(node),
                isAsync: false,
                bases: [],
                decorators: [],
              });
            }
          }
        }
        walk(child, state, stack, [], depth + 1, source);
      }
      return;
    }
    case 'call_expression': {
      if (state.calls.length < MAX_CALLS_PER_FILE) {
        const fnNode = node.childForFieldName('function');
        if (fnNode) {
          const callee = fnNode.text;
          const receiver = fnNode.type === 'member_expression' ? fnNode.childForFieldName('object')?.text ?? null : null;
          const argsNode = node.childForFieldName('arguments');
          const argCount = argsNode ? argsNode.namedChildren.length : 0;
          const assignedTo = null; // handled via parent assignment walk
          state.calls.push({
            callee,
            receiver,
            argumentsText: argsNode ? argsNode.text.slice(1, -1) : null,
            assignedTo,
            argumentCount: argCount,
            ownerQualifiedName: stack.length ? stack[stack.length - 1].qualifiedName : null,
            range: rangeOf(node),
          });
        }
      }
      break;
    }
    case 'decorator': {
      // collect for next class/method - but JS decorators are separate; handled via method_definition's decorator extraction?
      break;
    }
    default:
      break;
  }

  for (const child of node.namedChildren) {
    walk(child, state, stack, [], depth + 1, source);
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

function isExported(node: SyntaxNode): boolean {
  // Check if parent is export_statement or text starts with export
  const parent = (node as unknown as { parent?: SyntaxNode }).parent;
  if (parent && parent.type === 'export_statement') return true;
  // Walk up one more for nested
  const text = node.text.slice(0, 100);
  return text.startsWith('export');
}

function extractHeritage(node: SyntaxNode): string[] {
  const heritage = node.childForFieldName('heritage');
  if (!heritage) {
    // For class_declaration, heritage may be 'class_heritage'
    const alt = node.namedChildren.find((c) => c.type === 'class_heritage');
    if (!alt) return [];
    return alt.text
      .split(',')
      .map((s) => s.replace(/extends|implements/g, '').trim())
      .filter(Boolean);
  }
  return heritage.text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractMethodDecorators(node: SyntaxNode): SyntaxDecorator[] {
  const decorators: SyntaxDecorator[] = [];
  for (const child of node.children) {
    if (child.type === 'decorator') {
      const expr = child.namedChildren[0];
      if (!expr) continue;
      const name = expr.text.split('(')[0];
      const argsMatch = expr.text.match(/\(([\s\S]*)\)/);
      decorators.push({
        name,
        argumentsText: argsMatch ? argsMatch[1] : null,
        range: rangeOf(child as unknown as SyntaxNode),
      });
    }
  }
  return decorators;
}

function extractImport(node: SyntaxNode): SyntaxImport | null {
  const text = node.text;
  // ES import: import ... from "module" or import "module"
  const fromMatch = text.match(/from\s+["']([^"']+)["']/);
  const moduleName = fromMatch?.[1] ?? text.match(/import\s+["']([^"']+)["']/)?.[1] ?? null;
  if (!moduleName) return null;

  // Extract bindings between import and from
  const bindings: string[] = [];
  const aliases: Record<string, string> = {};
  const importClause = text.match(/import\s+([\s\S]*?)\s+from/);
  if (importClause) {
    const clause = importClause[1];
    // handle { a, b as c } and default
    const braceMatch = clause.match(/\{([^}]+)\}/);
    if (braceMatch) {
      for (const part of braceMatch[1].split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const [orig, alias] = trimmed.split(/\s+as\s+/).map((s) => s.trim());
        bindings.push(orig);
        if (alias) aliases[orig] = alias;
      }
    }
    // default import
    const defaultMatch = clause.match(/^\s*([a-zA-Z_$][\w$]*)\s*(?:,|\{)/);
    if (defaultMatch) {
      bindings.push(defaultMatch[1]);
    } else if (!braceMatch && clause.trim() && !clause.includes('*')) {
      const single = clause.trim().split(/\s+/)[0];
      if (/^[a-zA-Z_$][\w$]*$/.test(single)) bindings.push(single);
    }
    // namespace import * as X
    const nsMatch = clause.match(/\*\s+as\s+([a-zA-Z_$][\w$]*)/);
    if (nsMatch) {
      bindings.push(nsMatch[1]);
    }
  }

  // CommonJS require: const x = require("module")
  if (bindings.length === 0) {
    const reqMatch = text.match(/require\s*\(\s*["']([^"']+)["']\s*\)/);
    if (reqMatch && reqMatch[1] !== moduleName) {
      // already captured moduleName as req, but bindings from destructuring handled above
    }
  }

  const isRelative = moduleName.startsWith('.');
  const relativeLevel = isRelative ? (moduleName.match(/\.\.\//g) || []).length + (moduleName.startsWith('./') ? 1 : 0) : 0;
  // Check wildcard: import * as
  const isWildcard = text.includes('* as');

  return {
    module: moduleName,
    names: bindings.length ? bindings : [moduleName],
    aliases,
    relativeLevel,
    isWildcard,
    range: rangeOf(node),
  };
}
