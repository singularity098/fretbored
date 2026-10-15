#!/usr/bin/env node
// Renders the PNG app icons in assets/icons/ from assets/icon.svg and assets/icon-maskable.svg.
// Usage: node tools/make-icons.js   (needs Playwright + Chromium; dev-time only)
'use strict';
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
  console.error('Playwright not found (set PLAYWRIGHT_MODULE).');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const OUT = [
  // [source svg, size, file]
  ['icon.svg', 192, 'icon-192.png'],
  ['icon.svg', 512, 'icon-512.png'],
  ['icon-maskable.svg', 512, 'icon-maskable-512.png'],
  ['icon-maskable.svg', 180, 'apple-touch-icon.png'], // iOS rounds the corners itself
];

(async () => {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage();
  for (const [src, size, file] of OUT) {
    const svg = fs.readFileSync(path.join(root, 'assets', src), 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: path.join(root, 'assets', 'icons', file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote assets/icons/' + file);
  }
  await browser.close();
})();
