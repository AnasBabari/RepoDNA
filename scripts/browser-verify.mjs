/**
 * Deployed-production browser verification for RepoDNA.
 *
 * Drives https://repodna-one.vercel.app with headless Chrome via
 * puppeteer-core and records:
 *   - desktop + mobile screenshots (landing, progress, workspace, tabs)
 *   - console errors/warnings and failed network responses
 *   - PostHog request payloads, asserting no repository identity leakage
 *   - TXT export content (captured from the in-page Blob)
 *
 * Artifacts are written to outputs/browser-verification/ (gitignored).
 * Usage: node scripts/browser-verify.mjs <url-to-analyze>
 */

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const APP_URL = process.env.VERIFY_URL ?? 'https://repodna-one.vercel.app';
const TARGET_REPO = process.argv[2] ?? 'https://github.com/Graphify-Labs/graphify';
const REPO_SLUG = TARGET_REPO.replace(/^https?:\/\/github\.com\//, '');
const OUT_DIR = path.join(process.cwd(), 'outputs', 'browser-verification');

fs.mkdirSync(OUT_DIR, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  appUrl: APP_URL,
  targetRepo: REPO_SLUG,
  consoleErrors: [],
  consoleWarnings: [],
  failedRequests: [],
  posthogChecks: [],
  screenshots: [],
  txtExport: null,
  codeGraphVisible: false,
  analysisCompleted: false,
  errors: [],
};

function leakCheck(text, context) {
  // Repository identity must never enter third-party analytics payloads.
  const repoName = REPO_SLUG.split('/')[1] ?? REPO_SLUG;
  const tokens = [REPO_SLUG, repoName, 'graphify', 'gin-gonic'];
  const found = tokens.filter((t) => t && text.toLowerCase().includes(t.toLowerCase()));
  report.posthogChecks.push({ context, leaked: found, bytes: text.length });
  return found;
}

async function main() {
  const executablePath = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome/Edge executable found');
  console.log('Using browser:', executablePath);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.setDefaultTimeout(180000);

    // ---- Telemetry capture -------------------------------------------------
    page.on('console', (msg) => {
      if (msg.type() === 'error') report.consoleErrors.push(msg.text());
      else if (msg.type() === 'warning') report.consoleWarnings.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      report.failedRequests.push({ url: req.url(), error: req.failure()?.errorText });
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        report.failedRequests.push({ url: res.url(), status: res.status() });
      }
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (/posthog|ph\./i.test(url)) {
        const payload = req.postData() ?? '';
        const leaked = leakCheck(payload, url.slice(0, 120));
        if (leaked.length > 0) {
          report.errors.push(`PRIVACY LEAK in analytics payload: ${leaked.join(', ')}`);
        }
        req.respond({ status: 200, body: '{}', contentType: 'application/json' }).catch(() => {});
        return;
      }
      void req.continue();
    });

    // ---- Landing ------------------------------------------------------------
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    const landing = path.join(OUT_DIR, '01-landing-desktop.png');
    await page.screenshot({ path: landing, fullPage: false });
    report.screenshots.push(landing);
    console.log('Landing captured');

    // ---- Start analysis ------------------------------------------------------
    await page.waitForSelector('input[placeholder*="github.com"]', { visible: true, timeout: 60000 });
    await page.type('input[placeholder*="github.com"]', TARGET_REPO, { delay: 10 });
    const navPromise = Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 170000 }).catch(() => {}),
      page.click('button.analyse-button[type="submit"]'),
    ]);
    await navPromise;

    // Wait until the analyzing splash disappears or the workspace appears.
    const start = Date.now();
    let analysisMs = null;
    while (Date.now() - start < 165000) {
      const state = await page.evaluate(() => ({
        analyzing: Boolean(document.querySelector('.analyzing-container')),
        workspace: Boolean(document.querySelector('.workspace-shell') || document.querySelector('.sidebar')),
      })).catch(() => ({ analyzing: false, workspace: false }));
      if (!state.analyzing && state.workspace) {
        analysisMs = Date.now() - start;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    const progressShot = path.join(OUT_DIR, '02-post-analysis.png');
    await page.screenshot({ path: progressShot });
    report.screenshots.push(progressShot);

    if (analysisMs === null) {
      report.errors.push('Analysis did not reach the workspace within 165s');
    } else {
      report.analysisCompleted = true;
      report.analysisSeconds = Math.round(analysisMs / 1000);
      console.log(`Analysis completed in ${report.analysisSeconds}s`);
      await new Promise((r) => setTimeout(r, 3000)); // allow graphs to lay out

      const overview = path.join(OUT_DIR, '03-overview-desktop.png');
      await page.screenshot({ path: overview });
      report.screenshots.push(overview);

      // ---- Tab walkthrough ----------------------------------------------------
      async function visitTab(label, shotName) {
        const clicked = await page.evaluate((lbl) => {
          const buttons = Array.from(document.querySelectorAll('.nav-item'));
          const target = buttons.find((b) => b.textContent.trim().toLowerCase().includes(lbl));
          if (target) {
            target.click();
            return true;
          }
          return false;
        }, label).catch(() => false);
        if (!clicked) return;
        await new Promise((r) => setTimeout(r, 2500));
        const shot = path.join(OUT_DIR, shotName);
        await page.screenshot({ path: shot });
        report.screenshots.push(shot);
        if (label === 'code graph') report.codeGraphVisible = true;
        console.log(`Tab "${label}" captured`);
      }

      await visitTab('architecture', '04-architecture.png');
      await visitTab('code graph', '05-code-graph.png');

      // Interact with Code Graph: switch granularity + unresolved-only.
      try {
        await page.evaluate(() => {
          const selects = document.querySelectorAll('select');
          for (const s of selects) {
            const opt = Array.from(s.options).find((o) => o.value === 'symbols');
            if (opt) {
              s.value = 'symbols';
              s.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        });
        await new Promise((r) => setTimeout(r, 2000));
        const symShot = path.join(OUT_DIR, '06-code-graph-symbols.png');
        await page.screenshot({ path: symShot });
        report.screenshots.push(symShot);
      } catch {
        /* graph controls may not be present for this corpus */
      }

      await visitTab('routes & trace', '07-routes.png');
      await visitTab('dependencies', '08-dependencies.png');
      await visitTab('files & symbols', '09-files.png');

      // ---- TXT export ----------------------------------------------------------
      try {
        const txtContent = await page.evaluate(async () => {
          // The export button builds a Blob; replicate deterministically by
          // calling the same generator through the module scope is not possible,
          // so click the button and intercept via a patched anchor.
          // Trigger the real handler; capture object URL content.
          const buttons = Array.from(document.querySelectorAll('button.chip-button'));
          const txtBtn = buttons.find((b) => b.textContent.includes('TXT'));
          if (!txtBtn) return null;
          return new Promise((resolve) => {
            const OrigURL = URL.createObjectURL;
            URL.createObjectURL = (blob) => {
              blob.text().then((t) => resolve(t)).catch(() => resolve(null)).finally(() => {
                URL.createObjectURL = OrigURL;
              });
              return OrigURL(blob);
            };
            txtBtn.click();
            setTimeout(() => resolve(null), 10000);
          });
        });
        if (txtContent) {
          const txtPath = path.join(OUT_DIR, `${REPO_SLUG.replace('/', '-')}-repodna-report.txt`);
          fs.writeFileSync(txtPath, txtContent, 'utf-8');
          const requiredSections = [
            'Repository identity', 'Safety statement', 'Repository inventory', 'Size classification',
            'Scan coverage and limitations', 'Languages', 'Frameworks and infrastructure',
            'Declared dependencies', 'Architecture areas', 'Entrypoints', 'Routes and handlers',
            'Execution paths', 'Modules', 'Symbols', 'Data models and tables', 'External systems',
            'Dependency communities', 'Dependency cycles', 'Central and high-coupling nodes',
            'Blast radius findings', 'Unresolved and ambiguous relationships',
            'Unsupported, skipped, partial, and failed files', 'Stage timings and limits',
          ];
          const missing = requiredSections.filter((s) => !txtContent.includes(s));
          report.txtExport = { path: txtPath, bytes: txtContent.length, missingSections: missing };
          console.log(`TXT export captured (${txtContent.length} bytes), missing sections: ${missing.length}`);
        } else {
          report.errors.push('TXT export could not be captured');
        }
      } catch (err) {
        report.errors.push(`TXT export failed: ${err.message}`);
      }
    }

    // ---- Mobile layout ----------------------------------------------------------
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    mobilePage.on('console', (msg) => {
      if (msg.type() === 'error') report.consoleErrors.push('[mobile] ' + msg.text());
    });
    await mobilePage.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    const mobileLanding = path.join(OUT_DIR, '10-landing-mobile.png');
    await mobilePage.screenshot({ path: mobileLanding, fullPage: false });
    report.screenshots.push(mobileLanding);

    // Mobile horizontal overflow check.
    const overflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    );
    report.mobileHorizontalOverflow = overflow;
    await mobilePage.close();
    console.log('Mobile layout captured, overflow:', overflow);
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(OUT_DIR, 'verification-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // ---- Summary ------------------------------------------------------------------
  console.log('\n=== VERIFICATION SUMMARY ===');
  console.log('Analysis completed:', report.analysisCompleted, report.analysisSeconds ? `(${report.analysisSeconds}s)` : '');
  console.log('Code Graph tab visible:', report.codeGraphVisible);
  console.log('Console errors:', report.consoleErrors.length);
  console.log('Failed requests:', report.failedRequests.length);
  console.log('PostHog checks:', report.posthogChecks.length, '(leaks:', report.posthogChecks.filter((c) => c.leaked.length > 0).length + ')');
  console.log('TXT export:', report.txtExport ? `${report.txtExport.bytes}B, missing sections: ${report.txtExport.missingSections.length}` : 'not captured');
  console.log('Screenshots:', report.screenshots.length);
  console.log('Internal errors:', report.errors.length);
  if (report.errors.length > 0) console.log(report.errors.join('\n'));
}

main().catch((err) => {
  console.error('Verification crashed:', err.message);
  report.errors.push(err.message);
  fs.writeFileSync(path.join(OUT_DIR, 'verification-report.json'), JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
