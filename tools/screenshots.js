#!/usr/bin/env node
// Captures the README screenshots in docs/screenshots/: every tab on desktop, plus a few on a phone.
// Usage: node tools/screenshots.js [tab ...]   (needs Playwright + Chromium; dev-time only)
// Re-run after visible UI changes. Pass tab names to redo only those.
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
const outDir = path.join(root, 'docs', 'screenshots');
const url = 'file://' + path.join(root, 'index.html');
const TABS = ['scales', 'chords', 'arpeggios', 'trainer', 'circle', 'tuner', 'metronome'];
const PHONE_TABS = ['scales', 'chords', 'arpeggios', 'metronome'];
const only = process.argv.slice(2);
const wanted = (tab) => !only.length || only.includes(tab);

const SIZES = [
  // [name, viewport, tabs, settings to change from the defaults]
  ['desktop', { width: 1280, height: 860 }, TABS, () => {}],
  ['phone', { width: 390, height: 844 }, PHONE_TABS, (s) => (s.fretboard.orientation = 'vertical')],
];

(async () => {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: exe });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, viewport, tabs, tweak] of SIZES) {
    const phone = name === 'phone';
    const ctx = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 });
    const page = await ctx.newPage();
    // Start from default settings so the shots don't depend on anything saved earlier.
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(`(${tweak})(FS.settings); FS.save();`);
    await page.waitForTimeout(300); // FS.save() is debounced
    for (const tab of tabs.filter(wanted)) {
      await page.goto(url + '#' + tab);
      await page.reload();
      await page.waitForTimeout(600); // lazy tab init + entrance animations
      const file = `${name}-${tab}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      console.log('wrote docs/screenshots/' + file);
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
