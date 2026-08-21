import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'docs', 'screenshots');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function findBrowserPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of paths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('No compatible Chrome or Edge executable found.');
}

async function isServerReady(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer(port = 3000) {
  const url = `http://localhost:${port}`;
  if (await isServerReady(url)) {
    console.log(`Server already running at ${url}`);
    return { process: null, url };
  }

  console.log(`Starting dev server on port ${port}...`);
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: rootDir,
    stdio: 'pipe',
    shell: true,
  });

  child.stdout.on('data', (d) => {
    const msg = d.toString();
    if (process.env.DEBUG) console.log('[server]', msg);
  });
  child.stderr.on('data', (d) => {
    const msg = d.toString();
    if (process.env.DEBUG) console.error('[server error]', msg);
  });

  const start = Date.now();
  while (Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 600));
    if (await isServerReady(url)) {
      console.log(`Server is ready at ${url}`);
      return { process: child, url };
    }
  }

  child.kill();
  throw new Error('Dev server failed to start within 30 seconds.');
}

async function run() {
  const browserPath = findBrowserPath();
  console.log('Using browser executable:', browserPath);

  const { process: serverProc, url } = await startServer(3000);

  console.log('Launching browser at 2x Retina resolution...');
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--hide-scrollbars=false'],
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
    },
  });

  try {
    const page = await browser.newPage();
    console.log('Navigating to', url);
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Wait for demo project to load
    await page.waitForSelector('.overview-hero', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1200));

    // 1. Overview screenshot
    console.log('Capturing overview.png...');
    await page.screenshot({
      path: path.join(outDir, 'overview.png'),
      fullPage: false,
    });

    // 2. Architecture screenshot
    console.log('Switching to Architecture view...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.nav-item'));
      const archBtn = buttons.find((b) => b.textContent?.includes('Architecture'));
      if (archBtn) archBtn.click();
    });
    await page.waitForSelector('.react-flow-shell', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 1500));
    console.log('Capturing architecture.png...');
    await page.screenshot({
      path: path.join(outDir, 'architecture.png'),
      fullPage: false,
    });

    // 3. Routes & trace screenshot
    console.log('Switching to Routes & trace view...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.nav-item'));
      const routesBtn = buttons.find((b) => b.textContent?.includes('Routes'));
      if (routesBtn) routesBtn.click();
    });
    await page.waitForSelector('.route-row', { timeout: 5000 });
    // Click on the first or second route to ensure a trace flow is open
    await page.evaluate(() => {
      const row = document.querySelector('.route-row');
      if (row) row.click();
    });
    await new Promise((r) => setTimeout(r, 1200));
    console.log('Capturing routes-trace.png...');
    await page.screenshot({
      path: path.join(outDir, 'routes-trace.png'),
      fullPage: false,
    });

    // 4. Dependencies screenshot
    console.log('Switching to Dependencies view...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.nav-item'));
      const depBtn = buttons.find((b) => b.textContent?.includes('Dependencies'));
      if (depBtn) depBtn.click();
    });
    await page.waitForSelector('.impact-search input', { timeout: 5000 });
    // Type a symbol search query
    await page.type('.impact-search input', 'UserService', { delay: 40 });
    await new Promise((r) => setTimeout(r, 1200));
    console.log('Capturing dependencies.png...');
    await page.screenshot({
      path: path.join(outDir, 'dependencies.png'),
      fullPage: false,
    });

    console.log('All screenshots captured successfully!');
  } finally {
    await browser.close();
    if (serverProc) {
      console.log('Stopping dev server...');
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', serverProc.pid.toString(), '/f', '/t']);
      } else {
        serverProc.kill();
      }
    }
  }
}

run().catch((err) => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
