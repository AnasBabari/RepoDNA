export const DEFAULT_IGNORES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'venv', '.venv', 'env', 'dist', 'build', 'coverage', '.next', '.vinext', '__pycache__',
  'vendor', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.idea', '.vscode', '.repodna', '.turbo', '.cache',
]);
export const SOURCE_EXTENSIONS = new Set([
  '.py', '.pyi', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go', '.json', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.sql',
  '.prisma', '.md', '.mdx', '.html', '.css', '.scss', '.dockerfile', '.sh', '.bash', '.graphql', '.gql',
]);
export const SUPPORTED_SOURCE_EXTENSIONS = new Set(['.py', '.pyi', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go']);
const OTHER_SOURCE_EXTENSIONS = new Set([
  '.rs', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.java', '.kt', '.kts', '.rb', '.php', '.cs', '.swift', '.scala', '.r',
  '.dart', '.vue', '.svelte', '.ex', '.exs', '.erl', '.hs', '.lua', '.zig', '.jl', '.clj', '.cljs', '.fs', '.pl', '.pm',
  '.sql', '.prisma', '.html', '.css', '.scss', '.sh', '.bash', '.graphql', '.gql', '.mdx',
]);
export const SPECIAL_FILES = new Set([
  'Dockerfile', 'Procfile', 'Makefile', 'Pipfile', 'package.json', 'requirements.txt', 'pyproject.toml', 'poetry.lock', 'Pipfile.lock',
  'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'tsconfig.json', 'jsconfig.json',
]);
function extension(path: string): string {
  const name = path.split('/').pop() ?? path;
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}
export function isSupportedSource(path: string): boolean { return SUPPORTED_SOURCE_EXTENSIONS.has(extension(path)); }
export function isSourcePath(path: string): boolean { return isSupportedSource(path) || OTHER_SOURCE_EXTENSIONS.has(extension(path)); }
export function isIgnored(path: string): boolean { return path.split('/').some((part) => DEFAULT_IGNORES.has(part)); }
export function isGeneratedPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes('/generated/') || lower.includes('__generated__') || lower.endsWith('.generated.ts') ||
    lower.endsWith('.generated.js') || lower.endsWith('.min.js') || lower.endsWith('.bundle.js') || lower.startsWith('dist/') || lower.startsWith('build/');
}
export function isCandidate(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return SPECIAL_FILES.has(name) || SOURCE_EXTENSIONS.has(extension(path)) ||
    /^requirements(?:[._-][\w.-]+)?\.txt$/i.test(name) || (path.split('/').includes('requirements') && name.endsWith('.txt'));
}
