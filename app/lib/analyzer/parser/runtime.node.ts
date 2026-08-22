import { join } from 'node:path';
import type { Language, Parser as TreeSitterParser } from 'web-tree-sitter';
import { createTreeSitterServices, type TreeSitterServices } from './runtime-core';
import type { SupportedLanguage } from './types';

let services: TreeSitterServices | null = null;

function assetDir(): string {
  return join(process.cwd(), 'public', 'tree-sitter');
}

function getServices(): TreeSitterServices {
  if (!services) {
    services = createTreeSitterServices({
      loadGlue: () => import('web-tree-sitter'),
      assetUrl: (file) => join(assetDir(), file),
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
