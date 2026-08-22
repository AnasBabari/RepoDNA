import { PythonSyntaxParser } from './python';
import type { SupportedLanguage, SyntaxParser } from './types';

interface LanguageRegistration {
  language: SupportedLanguage;
  extensions: readonly string[];
  factory: () => SyntaxParser;
}

const REGISTRY: readonly LanguageRegistration[] = [
  {
    language: 'python',
    extensions: ['.py', '.pyi'],
    factory: () => new PythonSyntaxParser(),
  },
];

const instances = new Map<SupportedLanguage, Promise<SyntaxParser>>();

export function registeredLanguages(): readonly SupportedLanguage[] {
  return REGISTRY.map((entry) => entry.language);
}

export function languageForExtension(extension: string): SupportedLanguage | null {
  const normalized = extension.toLowerCase();
  const entry = REGISTRY.find((candidate) => candidate.extensions.includes(normalized));
  return entry ? entry.language : null;
}

export function languageForPath(path: string): SupportedLanguage | null {
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex === -1) return null;
  return languageForExtension(path.slice(dotIndex));
}

export function getSyntaxParser(language: SupportedLanguage): Promise<SyntaxParser> | null {
  const registration = REGISTRY.find((entry) => entry.language === language);
  if (!registration) return null;

  let instance = instances.get(language);
  if (!instance) {
    instance = (async () => {
      const parser = registration.factory();
      await parser.initialise();
      return parser;
    })();
    instances.set(language, instance);
    instance.catch(() => instances.delete(language));
  }
  return instance;
}
