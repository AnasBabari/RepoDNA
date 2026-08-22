import type { Language, Parser as TreeSitterParser } from 'web-tree-sitter';
import { ParserError, type SupportedLanguage } from './types';

type TreeSitterModule = typeof import('web-tree-sitter');

const BROWSER_WASM_BASE = '/tree-sitter';
const CORE_WASM_FILE = 'web-tree-sitter.wasm';
const GRAMMAR_WASM_FILES: Partial<Record<SupportedLanguage, string>> = {
  python: 'tree-sitter-python.wasm',
};

let modulePromise: Promise<TreeSitterModule> | null = null;
const grammarCache = new Map<SupportedLanguage, Promise<Language>>();
const parserCache = new Map<SupportedLanguage, Promise<TreeSitterParser>>();

function isNodeLike(): boolean {
  return typeof process !== 'undefined' && Boolean((process as { versions?: { node?: string } }).versions?.node);
}

function wasmBasePath(): string {
  if (!isNodeLike()) return BROWSER_WASM_BASE;
  const url = new URL('../../../../public/tree-sitter/', import.meta.url);
  const raw = decodeURIComponent(url.pathname);
  return raw.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/+$/, '');
}

function coreWasmName(file: string): string {
  if (file.endsWith('.wasm') && !file.startsWith('tree-sitter-')) return CORE_WASM_FILE;
  return file;
}

async function loadTreeSitterModule(): Promise<TreeSitterModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const mod = await import('web-tree-sitter');
        const base = wasmBasePath();
        await mod.Parser.init({
          locateFile: (file: string) => `${base}/${coreWasmName(file)}`,
        });
        return mod;
      } catch (error) {
        modulePromise = null;
        throw new ParserError(
          'TREE_SITTER_INIT_FAILED',
          `Failed to initialise the Tree-sitter runtime: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })();
  }
  return modulePromise;
}

export function initialiseTreeSitter(): Promise<void> {
  return loadTreeSitterModule().then(() => undefined);
}

export async function loadGrammar(language: SupportedLanguage): Promise<Language> {
  let grammar = grammarCache.get(language);
  if (!grammar) {
    grammar = (async () => {
      const wasmFile = GRAMMAR_WASM_FILES[language];
      if (!wasmFile) {
        throw new ParserError('UNSUPPORTED_LANGUAGE', `No grammar asset registered for language "${language}".`);
      }
      const mod = await loadTreeSitterModule();
      try {
        return await mod.Language.load(`${wasmBasePath()}/${wasmFile}`);
      } catch (error) {
        grammarCache.delete(language);
        throw new ParserError(
          'TREE_SITTER_GRAMMAR_LOAD_FAILED',
          `Failed to load the "${language}" grammar: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })();
    grammarCache.set(language, grammar);
  }
  return grammar;
}

export async function getTreeSitterParser(language: SupportedLanguage): Promise<TreeSitterParser> {
  let parser = parserCache.get(language);
  if (!parser) {
    parser = (async () => {
      const [mod, grammar] = await Promise.all([loadTreeSitterModule(), loadGrammar(language)]);
      const instance = new mod.Parser();
      instance.setLanguage(grammar);
      return instance;
    })();
    parserCache.set(language, parser);
  }
  return parser;
}
