import type { Language, Parser as TreeSitterParser } from 'web-tree-sitter';
import { ParserError, type SupportedLanguage } from './types';

export type TreeSitterModule = typeof import('web-tree-sitter');

const GRAMMAR_WASM_FILES: Partial<Record<SupportedLanguage, string>> = {
  python: 'tree-sitter-python.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  go: 'tree-sitter-go.wasm',
};

export interface PlatformRuntime {
  loadGlue(): Promise<TreeSitterModule>;
  assetUrl(file: string): string;
}

export interface TreeSitterServices {
  initialise(): Promise<void>;
  loadGrammar(language: SupportedLanguage): Promise<Language>;
  getParser(language: SupportedLanguage): Promise<TreeSitterParser>;
}

function coreWasmName(file: string): string {
  if (file.endsWith('.wasm') && !file.startsWith('tree-sitter-')) return 'web-tree-sitter.wasm';
  return file;
}

export function createTreeSitterServices(platform: PlatformRuntime): TreeSitterServices {
  let modulePromise: Promise<TreeSitterModule> | null = null;
  const grammarCache = new Map<SupportedLanguage, Promise<Language>>();
  const parserCache = new Map<SupportedLanguage, Promise<TreeSitterParser>>();

  async function loadGlueOnce(): Promise<TreeSitterModule> {
    if (!modulePromise) {
      modulePromise = (async () => {
        try {
          const mod = await platform.loadGlue();
          await mod.Parser.init({
            locateFile: (file: string) => platform.assetUrl(coreWasmName(file)),
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

  return {
    initialise() {
      return loadGlueOnce().then(() => undefined);
    },

    async loadGrammar(language: SupportedLanguage): Promise<Language> {
      let grammar = grammarCache.get(language);
      if (!grammar) {
        grammar = (async () => {
          const wasmFile = GRAMMAR_WASM_FILES[language];
          if (!wasmFile) {
            throw new ParserError('UNSUPPORTED_LANGUAGE', `No grammar asset registered for language "${language}".`);
          }
          const mod = await loadGlueOnce();
          try {
            return await mod.Language.load(platform.assetUrl(wasmFile));
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
    },

    async getParser(language: SupportedLanguage): Promise<TreeSitterParser> {
      let parser = parserCache.get(language);
      if (!parser) {
        parser = (async () => {
          const [mod, grammar] = await Promise.all([loadGlueOnce(), this.loadGrammar(language)]);
          const instance = new mod.Parser();
          instance.setLanguage(grammar);
          return instance;
        })();
        parserCache.set(language, parser);
      }
      return parser;
    },
  };
}
