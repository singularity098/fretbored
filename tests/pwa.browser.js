// Installable-app (PWA) test: serves the app over http://localhost, then checks that Chrome finds it
// installable, the service worker precaches every app file, it works offline, and an update to a
// file reaches the user on the next launch.
//
// Run with: node tests/pwa.browser.js   (needs Playwright + Chromium, like smoke.browser.js)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
  try {
    ({ chromium } = require(m));
    break;
  } catch (e) {
    /* try next */
  }
}
if (!chromium) {
  console.error('Playwright not found. Set PLAYWRIGHT_MODULE to the playwright package path.');
  process.exit(2);
}
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const root = path.resolve(__dirname, '..');

const failures = [];
const check = (label, actual, expected) => {
  const ok = expected instanceof RegExp ? expected.test(actual) : actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}`);
  if (!ok) failures.push(`${label}: expected ${expected}, got ${actual}`);
};

// Minimal static server. `overrides` lets the test simulate a deploy without touching files.
const overrides = {};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  const body = overrides[p] !== undefined ? overrides[p] : fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  res.end(body);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}/`;
  // A persistent (non-incognito) profile: Chrome never offers installation in incognito.
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fretbored-pwa-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath, viewport: { width: 390, height: 844 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`));

  // 1. First visit installs the service worker; it then controls the page.
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  check('service worker controls the page', String(await page.evaluate(() => !!navigator.serviceWorker.controller)), 'true');

  // 2. Installable according to Chrome, and the manifest's icons all load.
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  check('Chrome installability errors', JSON.stringify(installabilityErrors.map((e) => e.errorId)), '[]');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    const status = await page.evaluate(async (src) => (await fetch(src)).status, icon.src);
    check(`icon ${icon.src}`, String(status), '200');
  }
  check('has a maskable icon', String(manifest.icons.some((i) => i.purpose === 'maskable')), 'true');

  // 3. Every script and stylesheet in index.html is precached by the service worker.
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const needed = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map((m) => m[1]);
  const missing = needed.filter((f) => !sw.includes(`'${f}'`));
  check('sw.js precaches every script/stylesheet in index.html', missing.join(', ') || 'none missing', 'none missing');
  const cached = await page.evaluate(async () => (await (await caches.open('fretbored')).keys()).length);
  check('files in the offline cache', String(cached >= needed.length + 3), 'true');

  // 4. Works offline: reload with the network off and use a couple of tabs.
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(300);
  check('offline: app loads', (await page.textContent('#panel-scales .hero-title')).trim(), /Major/);
  await page.click('#tab-arpeggios');
  await page.waitForTimeout(200);
  check('offline: arpeggios tab works', (await page.textContent('#panel-arpeggios .hero-title')).trim(), 'C major arpeggio');
  await ctx.setOffline(false);

  // 5. Updates: "deploy" a change; the next launch serves the cached copy and fetches the new one,
  //    the launch after that shows it.
  overrides['/index.html'] = html.replace('<title>Fretbored</title>', '<title>Fretbored (updated)</title>');
  await page.goto(base);
  await page.waitForTimeout(500); // background refresh completes
  await page.goto(base);
  check('update reaches the next launch', await page.title(), 'Fretbored (updated)');

  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
  server.close();
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n` + failures.join('\n'));
    process.exit(1);
  }
  console.log('\nPWA test passed');
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
