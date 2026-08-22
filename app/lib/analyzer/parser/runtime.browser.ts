import type { Language, Parser as TreeSitterParser } from 'web-tree-sitter';
import { createTreeSitterServices, type TreeSitterServices } from './runtime-core';
import type { SupportedLanguage } from './types';

const GLUE_ASSET_PATH = '/tree-sitter/web-tree-sitter.js';
const WASM_BASE_PATH = '/tree-sitter';

let services: TreeSitterServices | null = null;

function getServices(): TreeSitterServices {
  if (!services) {
    services = createTreeSitterServices({
      loadGlue: async () => {
        const glueUrl = new URL(GLUE_ASSET_PATH, globalThis.location.origin).href;
        return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ glueUrl);
      },
      assetUrl: (file) => `${WASM_BASE_PATH}/${file}`,
    });
  }
  return services;
}

export function initialiseTreeSitter(): Promise<void> {
  return getServices().initialise();
}

export function loadGrammar(language: SupportedLanguage): Promise<Language> {
  return getServices().loadGrammar(language);
}

export function getTreeSitterParser(language: SupportedLanguage): Promise<TreeSitterParser> {
  return getServices().getParser(language);
}
