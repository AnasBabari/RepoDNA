import type { SyntaxCall, SyntaxImport, SyntaxSymbol } from './types';

/** Syntax/import evidence only; naming or strings alone never establish UI. */
export function promoteComponentSymbols(symbols: SyntaxSymbol[], jsxOwners: Set<string>, imports: SyntaxImport[], calls: SyntaxCall[]): void {
  const factories = new Set<string>();
  for (const declaration of imports) {
    if (declaration.module !== 'react') continue;
    for (const name of declaration.names) {
      const binding = declaration.aliases[name] ?? name;
      factories.add(name === 'createElement' ? binding : `${binding}.createElement`);
    }
  }
  const owners = new Set(jsxOwners);
  for (const call of calls) if (call.ownerQualifiedName && factories.has(call.callee)) owners.add(call.ownerQualifiedName);
  for (const symbol of symbols) if (symbol.kind === 'function' && /^[A-Z]/.test(symbol.name) && owners.has(symbol.qualifiedName)) symbol.kind = 'component';
}
