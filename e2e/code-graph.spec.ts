import { expect, test, type Page } from '@playwright/test';

const GRAPH_URL = '/?repo=https://github.com/karpathy/nanoGPT';

type Point = { x: number; y: number };

async function openCodeGraph(page: Page): Promise<void> {
  await page.goto(GRAPH_URL);
  const nav = page.getByRole('button', { name: 'Code Graph' });
  await expect(nav).toBeVisible({ timeout: 60_000 });
  await nav.click();
  await expect(page.locator('.react-flow__node[data-id]').first()).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (baseURL && url.startsWith(baseURL)) return route.continue();
    return route.abort();
  });
});

async function collectNodeCenters(page: Page): Promise<Record<string, Point>> {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number }> = {};
    document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      out[el.getAttribute('data-id') as string] = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    return out;
  });
}

function pickIsolatedNode(centers: Record<string, Point>): string {
  let bestId = '';
  let bestDistance = -1;
  for (const [id, point] of Object.entries(centers)) {
    let nearest = Infinity;
    for (const [otherId, other] of Object.entries(centers)) {
      if (otherId === id) continue;
      nearest = Math.min(nearest, Math.hypot(point.x - other.x, point.y - other.y));
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      bestId = id;
    }
  }
  return bestId;
}

async function pickNodeWithMostEdges(page: Page): Promise<string> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-id') as string, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const counts = new Map<string, number>();
    document.querySelectorAll<SVGPathElement>('.react-flow__edge-path').forEach((path) => {
      const length = path.getTotalLength();
      const ctm = path.getScreenCTM();
      if (!ctm || !Number.isFinite(length)) return;
      for (const t of [0, length]) {
        const p = path.getPointAtLength(t);
        const s = new DOMPoint(p.x, p.y).matrixTransform(ctm);
        let bestId = '';
        let bestDistance = Infinity;
        for (const node of nodes) {
          const d = Math.hypot(node.x - s.x, node.y - s.y);
          if (d < bestDistance) {
            bestDistance = d;
            bestId = node.id;
          }
        }
        if (bestId && bestDistance < 20) counts.set(bestId, (counts.get(bestId) ?? 0) + 1);
      }
    });
    let bestId = '';
    let bestCount = -1;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
      }
    }
    return bestId;
  });
}

test.describe('Code Graph view', () => {
  test('renders the constellation with nodes and edges', async ({ page }) => {
    const pageErrors: string[] = [];
    const schemaConsoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('Error compiling schema')) {
        schemaConsoleErrors.push(message.text());
      }
    });

    await openCodeGraph(page);

    const nodes = page.locator('.react-flow__node[data-id]');
    await expect(nodes.first()).toBeVisible();
    expect(await nodes.count()).toBeGreaterThan(20);

    const edges = page.locator('.react-flow__edge');
    expect(await edges.count()).toBeGreaterThan(10);

    expect(pageErrors).toEqual([]);
    expect(schemaConsoleErrors).toEqual([]);
  });

  test('edge endpoints anchor to node handles', async ({ page }) => {
    await openCodeGraph(page);

    const sample = await page.evaluate(() => {
      const handles = Array.from(document.querySelectorAll<HTMLElement>('.code-node .react-flow__handle')).map((h) => {
        const r = h.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const endpoints: Array<{ x: number; y: number }> = [];
      const paths = Array.from(document.querySelectorAll<SVGPathElement>('.react-flow__edge-path')).slice(0, 60);
      for (const path of paths) {
        const length = path.getTotalLength();
        const ctm = path.getScreenCTM();
        if (!ctm || !Number.isFinite(length) || length === 0) continue;
        for (const t of [0, length]) {
          const p = path.getPointAtLength(t);
          const s = new DOMPoint(p.x, p.y).matrixTransform(ctm);
          endpoints.push({ x: s.x, y: s.y });
        }
      }
      return { handles, endpoints };
    });

    expect(sample.handles.length).toBeGreaterThan(16);
    expect(sample.endpoints.length).toBeGreaterThan(40);

    const tolerancePx = 12;
    for (const endpoint of sample.endpoints) {
      const minDistance = Math.min(
        ...sample.handles.map((h) => Math.hypot(h.x - endpoint.x, h.y - endpoint.y))
      );
      expect(
        minDistance,
        `edge endpoint (${endpoint.x.toFixed(1)}, ${endpoint.y.toFixed(1)}) is not anchored to any node handle`
      ).toBeLessThan(tolerancePx);
    }
  });

  test('dragging a node moves it and disturbs its neighbors', async ({ page }) => {
    await openCodeGraph(page);

    const before = await collectNodeCenters(page);
    const dragId = pickIsolatedNode(before);
    expect(dragId).toBeTruthy();
    const start = before[dragId];
    const dx = 120;
    const dy = 90;

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx / 2, start.y + dy / 2, { steps: 5 });
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(1200);

    const after = await collectNodeCenters(page);
    const movedSelf = Math.hypot(after[dragId].x - start.x, after[dragId].y - start.y);
    expect(movedSelf).toBeGreaterThan(dx * 0.5);

    let disturbed = 0;
    for (const [id, point] of Object.entries(before)) {
      if (id === dragId || !after[id]) continue;
      if (Math.hypot(after[id].x - point.x, after[id].y - point.y) > 6) disturbed++;
    }
    expect(disturbed, 'the live simulation should react to the drag').toBeGreaterThan(0);
  });

  test('hovering a node highlights its neighborhood and dims the rest', async ({ page }) => {
    await openCodeGraph(page);

    const hubId = await pickNodeWithMostEdges(page);
    expect(hubId).toBeTruthy();
    await page.locator(`.react-flow__node[data-id="${hubId}"] .code-node-glyph`).hover();

    await expect(page.locator('.code-node.is-hot').first()).toBeVisible();
    expect(await page.locator('.code-node.is-dimmed').count()).toBeGreaterThan(10);
    expect(await page.locator('.react-flow__edge.eg-hot').count()).toBeGreaterThanOrEqual(1);

    await page.mouse.move(720, 80);
    await expect(page.locator('.code-node.is-dimmed')).toHaveCount(0);
  });

  test('clicking a node opens its detail panel', async ({ page }) => {
    await openCodeGraph(page);

    await page.locator('.react-flow__node[data-id]').nth(4).locator('.code-node-glyph').click();

    await expect(page.locator('aside[aria-label="Node details"]')).toBeVisible();
  });

  test('keeps a large repository graph bounded and represented in the minimap', async ({ page }) => {
    await page.goto('/?repo=https://github.com/usestrix/strix');
    await expect(page.getByRole('button', { name: 'Code Graph' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Code Graph' }).click();
    await expect(page.locator('.react-flow__node[data-id]').first()).toBeVisible({ timeout: 30_000 });

    const status = await page.locator('.code-graph-status').textContent();
    expect(status).toMatch(/nodes/);
    const nodeCount = await page.locator('.react-flow__node[data-id]').count();
    const minimapNodeCount = await page.locator('.react-flow__minimap-node').count();
    expect(nodeCount).toBeLessThanOrEqual(240);
    expect(minimapNodeCount).toBeGreaterThan(0);
    expect(minimapNodeCount).toBeLessThanOrEqual(nodeCount);

    for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
      await page.locator('.react-flow__node[data-id]').nth(index).locator('.code-node-glyph').click();
    }
    await page.waitForTimeout(300);
    expect(await page.locator('.react-flow__node[data-id]').count()).toBeLessThanOrEqual(240);
    expect(await page.locator('.react-flow__minimap-node').count()).toBeGreaterThan(0);
  });
});
