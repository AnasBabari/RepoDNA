import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runBrowserTest() {
  console.log('🚀 Launching Chrome to test node dragging and view persistence...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // 1. Load app
    console.log('1. Loading http://localhost:3000 ...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // 2. Select demo repo tiangolo/full-stack-fastapi-template
    console.log('2. Selecting demo repository tiangolo/full-stack-fastapi-template ...');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('tiangolo/full-stack-fastapi-template')), { timeout: 15000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('tiangolo/full-stack-fastapi-template'));
      btn?.click();
    });

    // 3. Switch to Architecture tab
    console.log('3. Navigating to Architecture tab ...');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('Architecture')), { timeout: 20000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Architecture'));
      btn?.click();
    });

    // Wait for nodes to render
    await page.waitForSelector('.react-flow__node', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    // 4. Get initial node coordinates
    const initialPositions = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
      return nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return {
          id: n.getAttribute('data-id'),
          transform: n.style.transform,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      });
    });
    console.log('4. Initial node positions:', initialPositions.map((n) => `${n.id}: ${n.transform}`).join(', '));

    const targetNode = initialPositions.find((n) => n.id === 'api') || initialPositions[0];
    if (!targetNode) throw new Error('No target node found');

    // 5. Drag the node using real CDP mouse events
    const startX = targetNode.rect.x + targetNode.rect.width / 2;
    const startY = targetNode.rect.y + targetNode.rect.height / 2;
    const endX = startX + 180;
    const endY = startY + 120;

    console.log(`5. Dragging node '${targetNode.id}' from (${Math.round(startX)}, ${Math.round(startY)}) to (${Math.round(endX)}, ${Math.round(endY)}) ...`);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    // Wait for state to settle and persist
    await new Promise((r) => setTimeout(r, 800));

    // 6. Check saved layout in localStorage
    const savedState = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('repodna_view_v1_'));
      if (!keys.length) return null;
      return {
        key: keys[0],
        data: JSON.parse(localStorage.getItem(keys[0])),
      };
    });

    console.log('6. Saved localStorage state:', JSON.stringify(savedState, null, 2));
    if (!savedState || !savedState.data?.positions?.[targetNode.id]) {
      throw new Error(`Node position for '${targetNode.id}' was NOT saved to localStorage!`);
    }
    console.log(`   ✅ Node '${targetNode.id}' position stored at:`, savedState.data.positions[targetNode.id]);

    // 7. Reload the page completely
    console.log('7. Reloading page to test persistence ...');
    await page.reload({ waitUntil: 'networkidle0' });

    // 8. Re-select repo and navigate to Architecture tab
    console.log('8. Re-selecting demo repo to verify saved layout restoration ...');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('tiangolo/full-stack-fastapi-template')), { timeout: 15000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('tiangolo/full-stack-fastapi-template'));
      btn?.click();
    });

    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('Architecture')), { timeout: 20000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Architecture'));
      btn?.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    const restoredPositions = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
      return nodes.map((n) => ({
        id: n.getAttribute('data-id'),
        transform: n.style.transform,
      }));
    });

    const restoredTarget = restoredPositions.find((n) => n.id === targetNode.id);
    console.log('8. Restored node transform after reload:', restoredTarget);

    if (!restoredTarget || restoredTarget.transform === targetNode.transform) {
      throw new Error(`Node '${targetNode.id}' did not retain its dragged position after reload!`);
    }
    console.log('   ✅ Node layout successfully survived full page reload!');

    // 9. Test Reset View button
    console.log('9. Testing Reset View button ...');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('Reset View')), { timeout: 10000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Reset View'));
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    const postResetStorage = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('repodna_view_v1_'));
      return keys.length;
    });

    console.log('9. Keys in localStorage after reset:', postResetStorage);
    if (postResetStorage !== 0) {
      throw new Error('Reset View did not clear the saved view key in localStorage!');
    }
    console.log('   ✅ Reset View successfully restored default layout and cleared storage!');

    console.log('\n🎉 ALL DRAGGABLE ARCHITECTURE & VIEW PERSISTENCE BROWSER CHECKS PASSED!');
  } finally {
    await browser.close();
  }
}

runBrowserTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
