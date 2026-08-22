import type { Diagnostic, ImportRecord, RouteRecord } from './types';
import type { ExpressMountRecord, PartialAnalysis } from './types';

type ResolvedMount = {
  mount: ExpressMountRecord;
  target: string;
  prefix: string;
};

function joinRoutePaths(prefix: string, routePath: string): string {
  const left = prefix === '/' ? '' : `/${prefix.replace(/^\/+|\/+$/g, '')}`;
  const right = routePath === '/' ? '' : `/${routePath.replace(/^\/+|\/+$/g, '')}`;
  return `${left}${right}` || '/';
}

function looksLikeRouterMount(mount: ExpressMountRecord): boolean {
  return /router|routes?|require\s*\(|import\s*\(/i.test(mount.targetExpression)
    || /route|prefix|path/i.test(mount.prefixExpression ?? '')
    || Boolean(mount.targetModule && /routes?|router/i.test(mount.targetModule));
}

function resolveMountTarget(mount: ExpressMountRecord, imports: ImportRecord[]): string | null {
  const localImports = imports.filter((edge) => edge.source === mount.file && edge.target);
  if (mount.targetModule) {
    return localImports.find((edge) => edge.module === mount.targetModule)?.target ?? null;
  }
  if (mount.targetIdentifier) {
    return localImports.find((edge) => edge.names.includes(mount.targetIdentifier!))?.target ?? null;
  }
  return null;
}

function pushDiagnostic(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  if (diagnostics.some((item) => item.code === diagnostic.code && item.file === diagnostic.file && item.message === diagnostic.message)) {
    return;
  }
  diagnostics.push(diagnostic);
}

function unresolvedMountDiagnostic(mount: ExpressMountRecord, dynamic: boolean): Diagnostic {
  const call = `${mount.receiver}.use(${[mount.prefixExpression, mount.targetExpression].filter(Boolean).join(', ')})`;
  return {
    severity: 'warning',
    code: dynamic ? 'DYNAMIC_ROUTE_MOUNT_UNRESOLVED' : 'EXPRESS_ROUTE_MOUNT_UNRESOLVED',
    message: dynamic
      ? `Could not resolve dynamic Express mount "${call}" at line ${mount.line}; routes beneath this mount may be missing or have incomplete paths.`
      : `Could not resolve Express router target "${mount.targetExpression}" mounted at "${mount.prefix ?? '/'}" on line ${mount.line}; routes beneath this mount may be missing.`,
    file: mount.file,
  };
}

function routeDirectoryCandidate(path: string): boolean {
  return /(^|\/)(?:routes?|routers?)(?:\/|$)/i.test(path);
}

function unresolvedRouteCandidates(
  mount: ExpressMountRecord,
  routes: RouteRecord[],
  resolvedTargets: Set<string>
): RouteRecord[] {
  const expressRoutes = routes.filter((route) =>
    route.framework === 'Express' && route.file !== mount.file && !resolvedTargets.has(route.file)
  );
  const mountDirectory = mount.file.includes('/') ? mount.file.slice(0, mount.file.lastIndexOf('/') + 1) : '';
  const nearbyRouteFiles = expressRoutes.filter((route) =>
    route.file.startsWith(mountDirectory) && routeDirectoryCandidate(route.file)
  );
  if (nearbyRouteFiles.length) return nearbyRouteFiles;

  const routeFiles = expressRoutes.filter((route) => routeDirectoryCandidate(route.file));
  return routeFiles.length ? routeFiles : expressRoutes;
}

function incompletePathDiagnostic(mount: ExpressMountRecord, route: RouteRecord): Diagnostic {
  const call = `${mount.receiver}.use(${[mount.prefixExpression, mount.targetExpression].filter(Boolean).join(', ')})`;
  return {
    severity: 'warning',
    code: 'EXPRESS_ROUTE_PATH_INCOMPLETE',
    message: `Full mounted path unresolved for ${route.method} ${route.path}; this is the router-local path from ${route.file}:${route.line}. Runtime mount "${call}" at ${mount.file}:${mount.line} could not be followed statically.`,
    file: route.file,
  };
}

export function resolveExpressRouteMounts(
  partials: PartialAnalysis[],
  imports: ImportRecord[],
  diagnostics: Diagnostic[]
): RouteRecord[] {
  const routes = partials.flatMap((partial) => partial.routes);
  const mounts = partials.flatMap((partial) => partial.expressMounts ?? []);
  if (!mounts.length) return routes;

  const routeFiles = new Set(routes.filter((route) => route.framework === 'Express').map((route) => route.file));
  const mountFiles = new Set(mounts.map((mount) => mount.file));
  const resolved: ResolvedMount[] = [];
  const unresolved: ExpressMountRecord[] = [];

  for (const mount of mounts) {
    const target = resolveMountTarget(mount, imports);
    const targetHasRouteSurface = Boolean(target && (routeFiles.has(target) || mountFiles.has(target)));
    if (target && targetHasRouteSurface && mount.prefix !== null) {
      resolved.push({ mount, target, prefix: mount.prefix });
      continue;
    }

    // A computed prefix is always a coverage gap. Do not let target-resolution
    // heuristics suppress the warning for directory-loaded runtime routers.
    if (mount.prefix === null || looksLikeRouterMount(mount)) unresolved.push(mount);
  }

  const resolvedTargets = new Set(resolved.map((item) => item.target));
  for (const mount of unresolved) {
    pushDiagnostic(diagnostics, unresolvedMountDiagnostic(mount, mount.dynamic || mount.prefix === null));
    for (const route of unresolvedRouteCandidates(mount, routes, resolvedTargets)) {
      pushDiagnostic(diagnostics, incompletePathDiagnostic(mount, route));
    }
  }

  if (!resolved.length) return routes;

  const targetedFiles = new Set(resolved.map((item) => item.target));
  const parentFiles = new Set(resolved.map((item) => item.mount.file));
  const prefixesByFile = new Map<string, Set<string>>();
  for (const parent of parentFiles) {
    if (!targetedFiles.has(parent)) prefixesByFile.set(parent, new Set(['']));
  }

  let changed = true;
  for (let pass = 0; changed && pass <= resolved.length; pass++) {
    changed = false;
    for (const item of resolved) {
      const parentPrefixes = prefixesByFile.get(item.mount.file);
      if (!parentPrefixes?.size) continue;
      if (!prefixesByFile.has(item.target)) prefixesByFile.set(item.target, new Set());
      const targetPrefixes = prefixesByFile.get(item.target)!;
      for (const parentPrefix of parentPrefixes) {
        const mountedPrefix = joinRoutePaths(parentPrefix || '/', item.prefix);
        if (!targetPrefixes.has(mountedPrefix)) {
          targetPrefixes.add(mountedPrefix);
          changed = true;
        }
      }
    }
  }

  for (const item of resolved) {
    if (!prefixesByFile.get(item.target)?.size) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'EXPRESS_ROUTE_MOUNT_UNRESOLVED',
        message: `Resolved router "${item.mount.targetExpression}" but could not establish a root mount path; routes beneath it may be incomplete.`,
        file: item.mount.file,
      });
    }
  }

  const expanded: RouteRecord[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    const prefixes = route.framework === 'Express' && targetedFiles.has(route.file)
      ? Array.from(prefixesByFile.get(route.file) ?? [])
      : [''];
    const effectivePrefixes = prefixes.length ? prefixes : [''];
    for (const prefix of effectivePrefixes) {
      const path = prefix ? joinRoutePaths(prefix, route.path) : route.path;
      const key = `${route.method}:${path}:${route.handler}:${route.file}:${route.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({
        ...route,
        id: path === route.path ? route.id : `route:${route.file}:${route.line}:${route.method}:${path}`,
        path,
      });
    }
  }
  return expanded;
}
