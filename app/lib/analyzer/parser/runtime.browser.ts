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
      grammarInput: async (file) => {
        // Pass bytes explicitly: browser process shims may lack `versions`,
        // which upstream Language.load's string-path Node detection assumes.
        const response = await fetch(`${WASM_BASE_PATH}/${file}`);
        if (!response.ok) throw new Error(`Grammar asset request failed (${response.status}).`);
        return new Uint8Array(await response.arrayBuffer());
      },
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
