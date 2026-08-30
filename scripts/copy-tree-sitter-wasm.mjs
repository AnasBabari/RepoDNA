import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function fileContentsEqual(left, right) {
  try {
    const a = statSync(left);
    const b = statSync(right);
    if (a.size !== b.size) return false;
    if (a.size > 64 * 1024 * 1024) return false;
    return readFileSync(left).equals(readFileSync(right));
  } catch {
    return false;
  }
}

function trySyncCopyViaStream(source, destination) {
  // copyFileSync can fail with UNKNOWN on Windows when Defender/OneDrive holds a
  // brief exclusive lock; a manual read/write copy uses different FS semantics
  // and frequently succeeds where the specialized copy syscall does not.
  try {
    const { writeFileSync } = require('node:fs');
    writeFileSync(destination, readFileSync(source));
    return true;
  } catch {
    return false;
  }
}

async function copyWithRetry(source, destination, attempts = 6) {
  // On Windows, antivirus/OneDrive indexing can transiently lock a file and
  // make copyFileSync throw UNKNOWN. Retry with backoff so a one-off lock never
  // fails the entire build. If a lock still persists and the destination already
  // contains identical bytes (e.g. a repeat build after a prior successful copy),
  // treat the copy as already satisfied instead of failing hard.
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      copyFileSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (trySyncCopyViaStream(source, destination)) return;
      if (fileContentsEqual(source, destination)) return;
      if (attempt === attempts) break;
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

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
  await copyWithRetry(source, join(outDir, file));
  console.log(`[copy-tree-sitter-wasm] ${pkg}/${file} -> public/tree-sitter/${file}`);
}
