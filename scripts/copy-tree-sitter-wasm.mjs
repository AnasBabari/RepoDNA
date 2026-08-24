import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolvePackageDir(specifier) {
  try {
    return dirname(require.resolve(`${specifier}/package.json`));
  } catch {
    try {
      return dirname(require.resolve(specifier));
    } catch {
      const fallback = join(rootDir, 'node_modules', specifier);
      if (!existsSync(fallback)) {
        throw new Error(`[copy-tree-sitter-wasm] Cannot locate installed package "${specifier}". Run npm install first.`);
      }
      return fallback;
    }
  }
}

const ASSETS = [
  ['web-tree-sitter', 'web-tree-sitter.wasm'],
  ['web-tree-sitter', 'web-tree-sitter.js'],
  ['tree-sitter-python', 'tree-sitter-python.wasm'],
  ['tree-sitter-javascript', 'tree-sitter-javascript.wasm'],
  ['tree-sitter-typescript', 'tree-sitter-typescript.wasm'],
  ['tree-sitter-typescript', 'tree-sitter-tsx.wasm'],
  ['tree-sitter-go', 'tree-sitter-go.wasm'],
];

const outDir = join(rootDir, 'public', 'tree-sitter');
mkdirSync(outDir, { recursive: true });

for (const [pkg, file] of ASSETS) {
  const source = join(resolvePackageDir(pkg), file);
  if (!existsSync(source)) {
    throw new Error(`[copy-tree-sitter-wasm] Missing asset ${source}. Reinstall dependencies.`);
  }
  copyFileSync(source, join(outDir, file));
  console.log(`[copy-tree-sitter-wasm] ${pkg}/${file} -> public/tree-sitter/${file}`);
}
