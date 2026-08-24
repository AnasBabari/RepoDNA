import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getTreeSitterParser } from './runtime';
import type {
  ParseInput,
  ParsedSyntax,
  SourceRange,
  SupportedLanguage,
  SyntaxCall,
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

interface WalkState { symbols: SyntaxSymbol[]; imports: SyntaxImport[]; calls: SyntaxCall[]; errorNodes: number; nodeCount: number; packageName: string | null; }
interface Frame { qualifiedName: string; kind: 'class' | 'callable'; }

export class GoSyntaxParser implements SyntaxParser {
  language: SupportedLanguage = 'go';
  extensions = ['.go'] as const;
  async initialise(): Promise<void> { await getTreeSitterParser(this.language); }
  async parse(input: ParseInput): Promise<ParsedSyntax> {
    const parser = await getTreeSitterParser(this.language);
    let tree: import('web-tree-sitter').Tree | null = null;
    try {
      tree = parser.parse(input.source);
      const root = tree?.rootNode ?? null;
      if (!root) return { facts: failedFacts('go') };
      const state: WalkState = { symbols: [], imports: [], calls: [], errorNodes: 0, nodeCount: 0, packageName: null };
      // package clause first
      for (const child of root.namedChildren) {
        if (child.type === 'package_clause') {
          const nameNode = child.childForFieldName('name');
          if (nameNode) state.packageName = nameNode.text;
        }
      }
      for (const child of root.namedChildren) walk(child, state, [], 1);
      const hasErrors = state.errorNodes > 0 || root.hasError;
      return { facts: { language: 'go', symbols: state.symbols, imports: state.imports, calls: state.calls, hasMainGuard: false, parse: { success: true, hasErrors, errorNodes: state.errorNodes }, quality: hasErrors ? 'partial' : 'complete' } };
    } catch { return { facts: failedFacts('go') }; } finally { if (tree) try { tree.delete(); } catch {} }
  }
}
function failedFacts(lang: SupportedLanguage): SyntaxFacts {
  return { language: lang, symbols: [], imports: [], calls: [], hasMainGuard: false, parse: { success: false, hasErrors: true, errorNodes: 0 }, quality: 'failed' };
}
function walk(node: SyntaxNode, state: WalkState, stack: Frame[], depth: number): void {
  state.nodeCount += 1;
  if (state.nodeCount > MAX_AST_NODES || depth > MAX_AST_DEPTH) { state.errorNodes += 1; return; }
  if ((node as unknown as { isError?: boolean }).isError || (node as unknown as { isMissing?: boolean }).isMissing) state.errorNodes += 1;

  switch (node.type) {
    case 'import_declaration': {
      if (state.imports.length < MAX_IMPORTS_PER_FILE) {
        // Go imports: import "fmt" or import ( "fmt" "net/http" )
        const text = node.text;
        // Extract all quoted strings
        const matches = Array.from(text.matchAll(/"([^"]+)"/g));
        for (const m of matches) {
          const mod = m[1];
          // Alias handling: import alias "pkg"
          const aliasMatch = text.match(new RegExp(`([a-zA-Z_]\\w*)\\s+"${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
          const alias = aliasMatch ? aliasMatch[1] : null;
          if (alias && alias !== 'import') {
            state.imports.push({ module: mod, names: [mod.split('/').pop()!], aliases: { [mod]: alias }, relativeLevel: 0, isWildcard: false, range: rangeOf(node) });
          } else {
            state.imports.push({ module: mod, names: [mod.split('/').pop()!], aliases: {}, relativeLevel: 0, isWildcard: false, range: rangeOf(node) });
          }
          if (state.imports.length >= MAX_IMPORTS_PER_FILE) break;
        }
      }
      return;
    }
    case 'type_declaration': {
      // Handles type Foo struct { ... } and type Bar interface { ... }
      for (const child of node.namedChildren) {
        if (child.type === 'type_spec') {
          const nameNode = child.childForFieldName('name');
          const typeNode = child.childForFieldName('type');
          const name = nameNode?.text ?? '<anonymous>';
          const isInterface = typeNode?.type === 'interface_type';
          const isStruct = typeNode?.type === 'struct_type';
          const kind = isInterface ? 'interface' : isStruct ? 'class' : 'type';
          const parent = stack.length ? stack[stack.length - 1] : null;
          const qualifiedName = parent ? `${parent.qualifiedName}::${name}` : (state.packageName ? `${state.packageName}.${name}` : name);
          if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
            state.symbols.push({
              kind: kind as SyntaxSymbol['kind'],
              name,
              qualifiedName,
              range: rangeOf(child),
              parent: parent ? parent.qualifiedName : null,
              exported: /^[A-Z]/.test(name),
              isAsync: false,
              bases: extractEmbeddedTypes(typeNode),
              decorators: [],
            });
          }
          // Walk struct/interface body for fields/methods? Keep stack for nested
          if (isStruct || isInterface) {
            stack.push({ qualifiedName, kind: 'class' });
            if (typeNode) for (const sub of typeNode.namedChildren) walk(sub, state, stack, depth + 1);
            stack.pop();
          }
        }
      }
      return;
    }
    case 'function_declaration': {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const parent = stack.length ? stack[stack.length - 1] : null;
      const qualifiedName = state.packageName ? `${state.packageName}.${name}` : name;
      // Detect if it's a method: check receiver?
      const receiverNode = node.childForFieldName('receiver');
      const isMethod = !!receiverNode;
      const kind = isMethod ? 'method' : 'function';
      // For methods, parent is the struct type — try to extract receiver type
      let receiverType: string | null = null;
      if (receiverNode) {
        const param = receiverNode.namedChildren[0];
        const typeNode = param?.childForFieldName('type');
        receiverType = typeNode?.text?.replace(/^\*/, '') ?? null;
        if (receiverType) {
          // qualifiedName should be Receiver.Method
          const full = `${receiverType}::${name}`;
          if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
            state.symbols.push({ kind: 'method', name, qualifiedName: full, range: rangeOf(node), parent: receiverType, exported: /^[A-Z]/.test(name), isAsync: false, bases: [], decorators: [] });
          }
          stack.push({ qualifiedName: full, kind: 'callable' });
          for (const child of node.namedChildren) { if (child.id !== nameNode?.id && child.id !== receiverNode?.id) walk(child, state, stack, depth + 1); }
          stack.pop();
          return;
        }
      }
      if (state.symbols.length < MAX_SYMBOLS_PER_FILE) {
        state.symbols.push({ kind: kind as SyntaxSymbol['kind'], name, qualifiedName, range: rangeOf(node), parent: parent ? parent.qualifiedName : null, exported: /^[A-Z]/.test(name), isAsync: false, bases: [], decorators: [] });
      }
      stack.push({ qualifiedName, kind: 'callable' });
      for (const child of node.namedChildren) walk(child, state, stack, depth + 1);
      stack.pop();
      return;
    }
    case 'method_declaration': {
      // Some Go grammars use method_declaration separate
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? '<anonymous>';
      const receiverNode = node.childForFieldName('receiver');
      const typeNode = receiverNode?.namedChildren[0]?.childForFieldName('type');
      const receiverType = typeNode?.text?.replace(/^\*/, '') ?? 'unknown';
      const qualifiedName = `${receiverType}::${name}`;
      if (state.symbols.length < MAX_SYMBOLS_PER_FILE) state.symbols.push({ kind: 'method', name, qualifiedName, range: rangeOf(node), parent: receiverType, exported: /^[A-Z]/.test(name), isAsync: false, bases: [], decorators: [] });
      stack.push({ qualifiedName, kind: 'callable' });
      for (const child of node.namedChildren) walk(child, state, stack, depth + 1);
      stack.pop();
      return;
    }
    case 'call_expression': {
      if (state.calls.length < MAX_CALLS_PER_FILE) {
        const fnNode = node.childForFieldName('function');
        if (fnNode) {
          const callee = fnNode.text;
          // receiver is part before dot
          const dotIndex = callee.lastIndexOf('.');
          const receiver = dotIndex !== -1 ? callee.slice(0, dotIndex) : null;
          const argsNode = node.childForFieldName('arguments');
          const argCount = argsNode ? argsNode.namedChildren.length : 0;
          state.calls.push({ callee, receiver, argumentsText: argsNode ? argsNode.text.slice(1, -1) : null, assignedTo: null, argumentCount: argCount, ownerQualifiedName: stack.length ? stack[stack.length - 1].qualifiedName : null, range: rangeOf(node) });
        }
      }
      break;
    }
    default: break;
  }
  for (const child of node.namedChildren) walk(child, state, stack, depth + 1);
}

function rangeOf(node: SyntaxNode): SourceRange { return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, startColumn: node.startPosition.column, endColumn: node.endPosition.column }; }

function extractEmbeddedTypes(typeNode: SyntaxNode | null | undefined): string[] {
  if (!typeNode) return [];
  const bases: string[] = [];
  // For struct, look for field with embedded type? Simplified: check for type identifiers inside
  for (const child of typeNode.namedChildren) {
    if (child.type === 'field_declaration') {
      const type = child.childForFieldName('type');
      if (type && /^[A-Z]/.test(type.text)) bases.push(type.text);
    }
  }
  return bases;
}
