/**
 * Deterministic app harness for graph-export E2E tests.
 *
 * Everything runs offline:
 *  - all non-same-origin requests are aborted (mirrors e2e/code-graph.spec.ts),
 *  - public analysis flows are served canned RepoDNA v2 artifacts through
 *    route mocks (sample fetch + durable workflow endpoints),
 *  - the server export endpoint is intercepted to simulate Vercel failures.
 */
import { type Page, type Route } from '@playwright/test';

import {
  FIXTURE_COMMIT_SHA,
  buildCanonicalProjectV2,
} from '../fixtures/canonical-project';

export const SAMPLE_REPO_URL = 'https://github.com/karpathy/nanoGPT';
export const DURABLE_REPO_URL = 'https://github.com/e2e-fixtures/export-lab';
const ANALYTICS_CONSENT_KEY = 'repodna_analytics_consent';

export interface HarnessRequestLog {
  /** Every request URL seen by the page, in order. */
  urls: string[];
  /** POST bodies observed against the durable server export endpoint. */
  exportPostBodies: unknown[];
}

export type ServerExportMode = 'fallback-unavailable' | 'hard-fail';

export interface GraphExportHarness {
  requestLog: HarnessRequestLog;
  setServerExportBehavior: (mode: ServerExportMode) => void;
}


function canonicalArtifactJson(): string {
  return JSON.stringify(buildCanonicalProjectV2());
}

async function fulfillJson(route: Route, body: string, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body });
}

/**
 * Installs routing + telemetry spies. Must be awaited BEFORE page.goto.
 */
export async function installGraphExportHarness(page: Page): Promise<GraphExportHarness> {
  const log: HarnessRequestLog = { urls: [], exportPostBodies: [] };

  // Deterministic, quiet analytics surface.
  await page.addInitScript(
    ([key]) => {
      window.localStorage.setItem(key as string, 'granted');
      window.localStorage.removeItem('repodna_export_cache_consent');
      window.localStorage.removeItem('repodna:durable-analysis:v1');
    },
    [ANALYTICS_CONSENT_KEY]
  );

  const configuredPort = process.env.REPODNA_E2E_PORT ?? '3000';
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${configuredPort}`;

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(baseURL)) return route.fallback();
    return route.abort();
  });

  // Canned canonical artifact for the "featured sample" entry point. The app
  // fetches this same-origin asset before ever touching GitHub.
  await page.route('**/samples/nanogpt.json', (route) => fulfillJson(route, canonicalArtifactJson()));

  // Durable deep-analysis workflow endpoints (public-durable origin).
  await page.route('**/api/v2/analyses', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await fulfillJson(
      route,
      JSON.stringify({
        runId: 'run-e2e-1',
        status: 'pending',
        executionMode: 'workflow',
        repository: { owner: 'e2e-fixtures', name: 'export-lab' },
        commitSha: FIXTURE_COMMIT_SHA,
        statusEndpoint: '/api/v2/analyses/run-e2e-1',
        eventsEndpoint: '/api/v2/analyses/run-e2e-1/events',
        artifactEndpoint: '/api/v2/analyses/run-e2e-1/artifact',
      }),
      202
    );
  });
  await page.route('**/api/v2/analyses/run-e2e-1/events*', (route) => fulfillJson(route, '', 404));
  await page.route('**/api/v2/analyses/run-e2e-1', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await fulfillJson(
      route,
      JSON.stringify({
        runId: 'run-e2e-1',
        status: 'completed',
        statusEndpoint: '/api/v2/analyses/run-e2e-1',
        eventsEndpoint: '/api/v2/analyses/run-e2e-1/events',
        artifactEndpoint: '/api/v2/analyses/run-e2e-1/artifact',
        result: null,
        error: null,
      })
    );
  });
  await page.route('**/api/v2/analyses/run-e2e-1/artifact*', (route) =>
    fulfillJson(route, canonicalArtifactJson())
  );

  // Server-side derived-graph export endpoint. Default behaviour: fail with
  // the documented cache-unavailable + fallback payload; tests can override
  // per-run via overrideServerExport().
  let serverExportBehavior: ServerExportMode = 'fallback-unavailable';
  await page.route('**/api/v2/exports*', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    try {
      log.exportPostBodies.push(request.postDataJSON());
    } catch {
      log.exportPostBodies.push(null);
    }
    if (serverExportBehavior === 'hard-fail') {
      await fulfillJson(route, JSON.stringify({ error: { code: 'EXPORT_GENERATION_FAILED' } }), 500);
      return;
    }
    await fulfillJson(
      route,
      JSON.stringify({
        error: { code: 'EXPORT_CACHE_UNAVAILABLE', fallbackAvailable: true },
      }),
      500
    );
  });

  page.on('request', (request) => {
    log.urls.push(request.url());
  });

  const setServerExportBehavior = (mode: ServerExportMode): void => {
    serverExportBehavior = mode;
  };

  return { requestLog: log, setServerExportBehavior };
}
