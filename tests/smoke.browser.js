// Browser smoke test: loads the app from file:// in headless Chromium (desktop + phone sizes),
// exercises every tab and fails on any page error or wrong result.
//
// Run with: node tests/smoke.browser.js [screenshot-dir]
// Needs Playwright + Chromium. In Claude Code cloud sessions both are pre-installed; elsewhere set
// PLAYWRIGHT_MODULE (path to the playwright package) and CHROMIUM_PATH if they aren't found.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) {
      /* try the next one */
    }
  }
  console.error('Playwright not found. Set PLAYWRIGHT_MODULE to the playwright package path.');
  process.exit(2);
}

const { chromium } = loadPlaywright();
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const shots = process.argv[2];

// A guitar-like A2 tone 8 cents sharp, used as a fake microphone for the tuner.
function writeToneWav(file, freq) {
  const sr = 48000;
  const n = sr * 4;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = 0;
    [1, 0.6, 0.4, 0.25, 0.15].forEach((a, k) => (v += a * Math.sin(2 * Math.PI * freq * (k + 1) * (i / sr) + 0.3 * k)));
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 0.18)) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

const failures = [];
const check = (label, actual, expected) => {
  const ok = expected instanceof RegExp ? expected.test(actual) : actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}`);
  if (!ok) failures.push(`${label}: expected ${expected}, got ${actual}`);
};

(async () => {
  const wav = path.join(os.tmpdir(), `fretbored-a2-plus8-${process.pid}.wav`);
  writeToneWav(wav, 110 * Math.pow(2, 8 / 1200));
  const browser = await chromium.launch({
    executablePath,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
  });

  for (const [name, viewport] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, hasTouch: name === 'phone', permissions: ['microphone'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[${name}] page error: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && failures.push(`[${name}] console error: ${m.text()}`));
    const shot = async (n) => shots && page.screenshot({ path: path.join(shots, `${name}-${n}.png`), fullPage: true });
    await page.goto(url + '#scales');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(400);
    const P = `[${name}]`;

    // Layout: tab order, and the fretboard is the first section wherever it appears.
    check(`${P} tab order`, await page.$$eval('[role="tab"]', (t) => t.map((x) => x.dataset.tab).join(' ')), 'scales chords arpeggios trainer circle tuner metronome');
    for (const tab of ['scales', 'chords', 'arpeggios', 'trainer']) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(150);
      check(`${P} ${tab}: fretboard is the first section`, String(await page.$eval(`#panel-${tab}`, (p) => p.firstElementChild.classList.contains('board-card'))), 'true');
    }
    await page.click('#tab-scales');
    await page.waitForTimeout(150);

    // App colour themes: header palette menu, remembered; Dark stays the default.
    check(`${P} default theme`, await page.$eval('html', (e) => e.dataset.theme), 'dark');
    for (const th of ['light', 'amoled', 'dracula', 'solarized', 'tokyonight', 'latte', 'frappe', 'macchiato', 'mocha', 'dark']) {
      await page.click('#theme-btn');
      await page.click(`#theme-menu [data-id="${th}"]`);
      await page.waitForTimeout(100);
      check(`${P} theme ${th} applied`, await page.$eval('html', (e) => e.dataset.theme), th);
      check(`${P} theme menu closes`, String(await page.$eval('#theme-menu', (m) => m.hidden)), 'true');
      if (th !== 'dark') await shot(`theme-${th}`);
    }
    // Note dots take their colours from the app theme (no separate dot-colour picker).
    const rootFill = () => page.$eval('#panel-scales .fretboard .note.root .dot', (c) => getComputedStyle(c).fill);
    check(`${P} dark theme root dot colour`, await rootFill(), 'rgb(255, 122, 89)');
    check(`${P} no dot-colour picker`, String(await page.$$eval('.fb-settings .swatch', (s) => s.length)), '0');
    await page.click('#theme-btn');
    await page.click('#theme-menu [data-id="dracula"]');
    await page.waitForTimeout(300);
    check(`${P} dracula theme root dot colour`, await rootFill(), 'rgb(255, 121, 198)');
    await page.reload();
    await page.waitForTimeout(300);
    check(`${P} theme remembered`, await page.$eval('html', (e) => e.dataset.theme), 'dracula');
    await page.click('#theme-btn');
    await page.click('#theme-menu [data-id="dark"]');
    await page.waitForTimeout(100);

    // Fretboard settings: folded by default; opening it on one tab opens it on the others and is remembered.
    const fbOpen = (tab) => page.$eval(`#panel-${tab} .fb-settings`, (d) => d.open);
    check(`${P} fretboard settings folded by default`, String(await fbOpen('scales')), 'false');
    check(`${P} fretboard settings header shows tuning`, (await page.textContent('#panel-scales .fb-settings-tuning')).trim(), 'Standard · E A D G B E');
    await page.click('#panel-scales .fb-settings summary');
    await page.click('#tab-chords');
    await page.waitForTimeout(200);
    check(`${P} opening settings on Scales opens them on Chords`, String(await fbOpen('chords')), 'true');
    await page.click('#panel-chords .fb-settings summary');
    await page.click('#tab-scales');
    await page.waitForTimeout(200);
    check(`${P} closing on Chords closes on Scales`, String(await fbOpen('scales')), 'false');

    // Phones: swiping the page changes tab; swipes on the sideways-scrolling fretboard don't.
    if (name === 'phone') {
      const cdp = await ctx.newCDPSession(page);
      // stepMs > 0 makes a slow drag; hold leaves the finger down (call release() after).
      const swipe = async (sel, dx, { stepMs = 0, hold = false } = {}) => {
        const r = await page.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: Math.max(b.top, 0) + 40 }; });
        const pt = (x) => [{ x, y: r.y, id: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(r.x - dx / 2) });
        for (let k = 1; k <= 5; k++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(r.x - dx / 2 + (dx * k) / 5) });
          if (stepMs) await page.waitForTimeout(stepMs);
        }
        if (!hold) await release();
      };
      const release = async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(400);
      };
      const tab = () => page.$eval('[role="tab"][aria-selected="true"]', (b) => b.dataset.tab);
      const shift = (t) => page.$eval(`#panel-${t}`, (p) => { const m = getComputedStyle(p).transform; return m === 'none' ? 0 : Math.round(new DOMMatrix(m).m41); });
      // The page follows the finger while dragging, and springs back from a short, slow drag.
      await swipe('#panel-scales .hero', -100, { stepMs: 60, hold: true });
      check(`${P} swipe: page follows the finger`, String((await shift('scales')) < -60), 'true');
      await release();
      check(`${P} swipe: short slow drag springs back`, `${await tab()} ${await shift('scales')}`, 'scales 0');
      await swipe('#panel-scales .hero', -160);
      check(`${P} swipe left: next tab`, await tab(), 'chords');
      await swipe('#panel-chords .hero', 160);
      check(`${P} swipe right: previous tab`, await tab(), 'scales');
      await swipe('#panel-scales .hero', 160);
      check(`${P} swipe right on the first tab stays`, `${await tab()} ${await shift('scales')}`, 'scales 0');
      await page.click('#tab-circle');
      await swipe('#panel-circle .circle-card', -160);
      check(`${P} swipe left from Circle → Tuner`, await tab(), 'tuner');
      await page.click('#tab-scales');
      await page.waitForTimeout(150);
      await swipe('#panel-scales .fretboard-scroll', -160);
      check(`${P} swipe on the sideways fretboard scrolls it, not the tabs`, await tab(), 'scales');
      check(`${P} page never scrolls sideways`, String(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), 'true');
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    // Scales: remove F (low E, fret 1), then make A the root (right-click / Set-root mode).
    await page.click('#panel-scales .cell[data-s="0"][data-f="1"]');
    await page.waitForTimeout(150);
    check(`${P} scales: removing F gives a custom scale`, await page.textContent('#panel-scales .hero-title'), 'C Custom scale');
    await page.click('#panel-scales .cell[data-s="0"][data-f="1"]');
    await page.click('#panel-scales .tap-row button:has-text("Set root")');
    await page.click('#panel-scales .cell[data-s="0"][data-f="5"]');
    await page.waitForTimeout(150);
    check(`${P} scales: A as root of C major notes`, await page.textContent('#panel-scales .hero-title'), 'A Natural Minor (Aeolian)');
    await shot('scales');

    // Chords: C major open shape (x32010), then move the D string to fret 3 (F) → C E F G = Cadd11.
    await page.click('#tab-chords');
    await page.waitForTimeout(250);
    check(`${P} chords: default`, await page.textContent('#panel-chords .hero-title'), 'C');
    await page.click('#panel-chords .cell[data-s="2"][data-f="3"]');
    await page.waitForTimeout(150);
    check(`${P} chords: edited shape identified`, await page.textContent('#panel-chords .hero-title'), 'Cadd11');
    await shot('chords');

    // Arpeggios: C major open position, tab in playing order, position switch, playback highlight.
    await page.click('#tab-arpeggios');
    await page.waitForTimeout(250);
    check(`${P} arpeggios: title`, (await page.textContent('#panel-arpeggios .hero-title')).trim(), 'C major arpeggio');
    const tabFrets = () => page.$$eval('#panel-arpeggios .tab-note text', (els) => els.map((e) => e.textContent).join(' '));
    // Open C: low E 0 3, A 3, D 2, G 0, B 1, high E 0 3 — up and back down.
    check(`${P} arpeggios: open-position tab (up & down)`, await tabFrets(), '0 3 3 2 0 1 0 3 0 1 0 2 3 3 0');
    check(`${P} arpeggios: dots match tab`, String(await page.$$eval('#panel-arpeggios .fretboard .note', (n) => n.length)), '8');
    await page.click('#panel-arpeggios .pill[title^="Frets 5"]');
    await page.waitForTimeout(150);
    check(`${P} arpeggios: position 2 tab`, await tabFrets(), /^8 7 5 5 5 8 8/);
    await page.click('#panel-arpeggios .play-btn');
    await page.waitForTimeout(700);
    check(`${P} arpeggios: playback highlights the tab`, String(await page.$$eval('#panel-arpeggios .tab-note.on', (n) => n.length)), '1');
    await page.click('#panel-arpeggios .play-btn');
    await shot('arpeggios');

    // Vertical board (phones): Chords and Arpeggios crop to the shape, with a whole-neck toggle.
    if (name === 'phone') {
      const setVertical = (v) => page.evaluate((v) => { FS.settings.fretboard.orientation = v ? 'vertical' : 'horizontal'; FS.emit('fretboard'); }, v);
      const board = (tab) => page.$eval(`#panel-${tab} .fretboard`, (svg) => {
        const [, y0, , h] = svg.getAttribute('viewBox').split(' ').map(Number);
        const inView = (el) => { const y = el.transform.baseVal.length ? el.transform.baseVal[0].matrix.f : +el.getAttribute('y'); return y >= y0 && y <= y0 + h; };
        return { h, notes: svg.querySelectorAll('.note').length, notesShown: [...svg.querySelectorAll('.note')].filter(inView).length, mutesShown: [...svg.querySelectorAll('.mute')].filter(inView).length };
      });
      await setVertical(true);
      await page.waitForTimeout(150);
      let b = await board('arpeggios'); // position 2: frets 5–8 → shows frets 4–9
      check(`${P} vertical arpeggio: cropped to the shape`, String(b.h < 420), 'true');
      check(`${P} vertical arpeggio: every shape note visible`, `${b.notesShown}/${b.notes}`, '7/7');
      await page.click('#panel-arpeggios .neck-toggle');
      await page.waitForTimeout(150);
      check(`${P} vertical arpeggio: whole neck on request`, String((await board('arpeggios')).h > 900), 'true');
      await page.click('#panel-arpeggios .neck-toggle');
      await page.waitForTimeout(150);
      await page.click('#tab-chords');
      await page.waitForTimeout(150);
      await page.click('#panel-chords .pill[data-id="maj"]'); // C major
      await page.click('#panel-chords [aria-label="Position"] .pill:nth-child(2)');
      await page.waitForTimeout(150);
      b = await board('chords');
      check(`${P} vertical chord: cropped`, String(b.h < 420), 'true');
      check(`${P} vertical chord: muted-string marks visible`, String(b.mutesShown >= 1 || !(await page.$$eval('#panel-chords .mute', (m) => m.length))), 'true');
      await shot('chords-vertical');
      await setVertical(false);
      await page.click('#tab-arpeggios');
      await page.waitForTimeout(100);
    }

    // Circle of fifths: D Dorian.
    await page.click('#tab-circle');
    await page.waitForTimeout(250);
    check(`${P} circle: wheel is the first section`, String(await page.$eval('#panel-circle', (p) => !!p.firstElementChild.querySelector(':scope > .circle-card'))), 'true');
    await page.click('#panel-circle .pill:has-text("Dorian")');
    await page.waitForTimeout(150);
    check(`${P} circle: C Dorian`, await page.textContent('#panel-circle .hero-title'), 'C Dorian');
    // Clicking a ring puts the tonic on that ring: inner (B°) → middle (Am) must select A minor, not A Locrian.
    const tonicRing = () => page.$eval('#panel-circle .cof-seg.tonic', (g) => g.parentNode.classList[1]);
    await page.click('#panel-circle .cof-ring.dim .cof-seg:nth-child(1)');
    await page.waitForTimeout(100);
    check(`${P} circle: inner ring → B Locrian`, `${await page.textContent('#panel-circle .hero-title')} on ${await tonicRing()}`, 'B Locrian on dim');
    await page.click('#panel-circle .cof-ring.minor .cof-seg:nth-child(1)');
    await page.waitForTimeout(100);
    check(`${P} circle: then middle ring → A minor`, `${await page.textContent('#panel-circle .hero-title')} on ${await tonicRing()}`, 'A Aeolian (Minor) on minor');
    await page.click('#panel-circle .pill:has-text("Phrygian")');
    await page.click('#panel-circle .cof-ring.minor .cof-seg:nth-child(2)');
    await page.waitForTimeout(100);
    check(`${P} circle: middle ring keeps a minor mode`, `${await page.textContent('#panel-circle .hero-title')} on ${await tonicRing()}`, 'E Phrygian on minor');
    await page.click('#panel-circle .cof-ring.major .cof-seg:nth-child(2)');
    await page.waitForTimeout(100);
    check(`${P} circle: outer ring → major`, `${await page.textContent('#panel-circle .hero-title')} on ${await tonicRing()}`, 'G Ionian (Major) on major');
    await shot('circle');

    // Trainer: name mode scoring, fret range, strings, naturals, find mode, saved progress.
    await page.click('#tab-trainer');
    await page.waitForTimeout(250);
    const trPrompt = () => page.textContent('#panel-trainer .tr-prompt-text');
    check(`${P} trainer: default practice area`, (await page.textContent('#panel-trainer .pill.active')).trim(), 'Open – 12');
    const askedPc = () => page.evaluate(() => +document.querySelector('#panel-trainer .note').dataset.midi % 12);
    const answerRight = async () => {
      await page.click(`#panel-trainer .tr-answer[data-pc="${await askedPc()}"]`);
      await page.waitForTimeout(800);
    };
    await page.click(`#panel-trainer .tr-answer[data-pc="${await askedPc()}"]`);
    check(`${P} trainer: right answer`, await trPrompt(), /^✓ Correct/);
    await page.waitForTimeout(900);
    await page.click(`#panel-trainer .tr-answer[data-pc="${((await askedPc()) + 1) % 12}"]`);
    check(`${P} trainer: wrong answer`, await trPrompt(), /^✗ It’s/);
    const stats = await page.$$eval('#panel-trainer .tr-stat-val', (els) => els.map((e) => e.textContent).join(' '));
    check(`${P} trainer: score (asked correct accuracy streak)`, stats, /^2 1 50% 0 \(best 1\)$/);
    await page.waitForTimeout(1800);

    await page.click('#panel-trainer .pill:has-text("5 – 9")');
    const where = [];
    for (let i = 0; i < 10; i++) {
      where.push(await trPrompt());
      await answerRight();
    }
    check(`${P} trainer: questions within frets 5–9`, String(where.every((w) => { const f = +(w.match(/fret (\d+)/) || [0, -1])[1]; return f >= 5 && f <= 9; })), 'true');

    // Only string 6 (low E): turn the other five off.
    for (let n = 1; n <= 5; n++) await page.click(`#panel-trainer .tr-string[title="String ${n}"]`);
    const onStrings = [];
    for (let i = 0; i < 6; i++) {
      onStrings.push(await trPrompt());
      await answerRight();
    }
    check(`${P} trainer: only string 6 asked`, String(onStrings.every((w) => w.startsWith('String 6'))), 'true');
    for (let n = 1; n <= 5; n++) await page.click(`#panel-trainer .tr-string[title="String ${n}"]`);

    // Natural notes only: 7 answer buttons, natural questions.
    await page.click('#panel-trainer .tr-opt:has-text("Natural notes only")');
    const visible = await page.$$eval('#panel-trainer .tr-answer', (bs) => bs.filter((b) => !b.hidden).length);
    check(`${P} trainer: naturals shows 7 answer buttons`, String(visible), '7');
    const pcs = [];
    for (let i = 0; i < 8; i++) {
      pcs.push(await askedPc());
      await answerRight();
    }
    check(`${P} trainer: naturals only asks natural notes`, String(pcs.every((pc) => [0, 2, 4, 5, 7, 9, 11].includes(pc))), 'true');
    await page.click('#panel-trainer .tr-opt:has-text("Natural notes only")');

    // Find mode: one miss then all positions (counts as wrong), then a clean round.
    await page.click('#panel-trainer .seg button:has-text("Find the note")');
    await page.waitForTimeout(200);
    const findTargets = () => page.evaluate(() => {
      const txt = document.querySelector('#panel-trainer .tr-prompt-text').textContent;
      const name = txt.match(/Tap every (\S+)/)[1].split('/')[0];
      const pc = FS.theory.SHARP.findIndex((n) => FS.theory.pretty(n) === name);
      const st = FS.settings.trainer;
      const notes = FS.currentTuning().notes;
      const right = [];
      let wrong = null;
      notes.forEach((open, s) => {
        for (let f = st.from; f <= st.to; f++) {
          if ((open + f) % 12 === pc) right.push([s, f]);
          else if (!wrong) wrong = [s, f];
        }
      });
      return { right, wrong };
    });
    const tapCell = async ([s, f]) => {
      const el = await page.$(`#panel-trainer .cell[data-s="${s}"][data-f="${f}"] rect`);
      await el.scrollIntoViewIfNeeded();
      await el.click();
    };
    let tgt = await findTargets();
    await tapCell(tgt.wrong);
    check(`${P} trainer find: miss counted`, await trPrompt(), /1 miss/);
    for (const c of tgt.right) await tapCell(c);
    check(`${P} trainer find: finished with a miss`, await trPrompt(), /^✗ Here are all/);
    await page.waitForTimeout(1900);
    tgt = await findTargets();
    for (const c of tgt.right) await tapCell(c);
    check(`${P} trainer find: clean round`, await trPrompt(), /^✓ Found all/);
    await page.waitForTimeout(900);
    await page.click('#panel-trainer .seg button:has-text("Name the note")');

    const saved = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('fretbored:v1')).trainer.stats;
      return Object.values(st.days).reduce((a, r) => a + r[0], 0);
    });
    check(`${P} trainer: progress saved (questions answered today)`, String(saved), '28');
    check(`${P} trainer: history chart shows today`, String(await page.$$eval('#panel-trainer .tr-day-count', (d) => d[6].textContent)), /^\d+$/);
    await shot('trainer');

    // Metronome: one mixed buffer per beat; sixteenths at 120 BPM.
    await page.click('#tab-metronome');
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.__beats = [];
      const orig = FS.audio.playBuffer;
      FS.audio.playBuffer = (buf, when) => (window.__beats.push(when), orig(buf, when));
      FS.settings.metronome.bpm = 120;
    });
    await page.click('#panel-metronome .pill:has-text("Sixteenths")');
    await page.click('.start-btn');
    await page.waitForTimeout(1300);
    // ± while running: the display must go straight to the new tempo, never flash the old one back.
    const beatGaps = await page.evaluate(() => window.__beats.slice(1).map((t, i) => Math.round((t - window.__beats[i]) * 1000)));
    await page.evaluate(() => {
      window.__shown = [];
      const el = document.querySelector('.bpm-num');
      new MutationObserver(() => window.__shown.push(+el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const plus1 = page.locator('#panel-metronome button[aria-label="Increase tempo by 1"]');
    for (let k = 0; k < 6; k++) {
      await plus1.dispatchEvent('pointerdown');
      await plus1.dispatchEvent('pointerup');
      await page.waitForTimeout(170);
    }
    await page.waitForTimeout(600);
    const shown = await page.evaluate(() => window.__shown);
    check(`${P} metronome: ± shows only the new tempo`, String(shown.every((v, i) => i === 0 || v >= shown[i - 1]) && shown[shown.length - 1] === 126) + ` (${shown.join(' ')})`, /^true /);
    await page.click('.start-btn');
    await page.evaluate(() => { FS.settings.metronome.bpm = 120; FS.save(); });
    check(`${P} metronome: beats 500 ms apart at 120 BPM`, String([...new Set(beatGaps)]), '500');
    // Visual sync: +200 ms delays the beat lights by ~200 ms relative to the audio.
    const lightLag = async () => {
      await page.evaluate(() => {
        window.__beats = [];
        window.__lights = [];
        const dots = document.querySelector('.beat-dots');
        window.__mo = new MutationObserver(() => window.__lights.push(FS.audio.ctx().currentTime));
        window.__mo.observe(dots, { attributes: true, subtree: true, attributeFilter: ['class'] });
      });
      await page.click('.start-btn');
      await page.waitForTimeout(2600);
      await page.click('.start-btn');
      return page.evaluate(() => {
        window.__mo.disconnect();
        // One "on" toggle per beat change: keep the first record after each beat's audio time.
        const lags = window.__beats.map((when) => (window.__lights.find((t) => t >= when - 0.12) ?? NaN) - when).filter((x) => !isNaN(x));
        lags.sort((a, b) => a - b);
        return lags[Math.floor(lags.length / 2)] * 1000;
      });
    };
    const lag0 = await lightLag();
    await page.$eval('.sync-slider', (el) => { el.value = 200; el.dispatchEvent(new Event('input')); });
    check(`${P} metronome: sync readout`, (await page.textContent('.sync-val')).trim(), 'Lights 200 ms later');
    const lag200 = await lightLag();
    check(`${P} metronome: +200 ms sync delays the lights ~200 ms`, String(Math.abs(lag200 - lag0 - 200) < 50) + ` (${Math.round(lag0)} → ${Math.round(lag200)} ms)`, /^true /);
    await page.click('.sync-info button:has-text("Reset")');
    check(`${P} metronome: sync reset`, (await page.textContent('.sync-val')).trim(), 'In sync (0 ms)');
    await shot('metronome');

    // Tuner: fake mic plays A2 +8 cents.
    await page.click('#tab-tuner');
    await page.waitForTimeout(250);
    await page.click('.tn-start');
    await page.waitForTimeout(2000);
    check(`${P} tuner: note`, (await page.textContent('.tn-note')).trim(), 'A2');
    check(`${P} tuner: cents`, (await page.textContent('.tn-cents')).trim(), /^\+(7\.[5-9]|8\.[0-5]) ¢$/);
    await shot('tuner');
    await page.click('#tab-scales');
    await page.waitForTimeout(150);
    check(`${P} tuner: mic released on leaving tab`, (await page.textContent('.tn-start')).trim(), /Start tuner/);

    await ctx.close();
  }

  // 60-second challenge, with a fake clock so it doesn't take a minute.
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`[challenge] page error: ${e.message}`));
    await page.clock.install();
    await page.goto(url + '#trainer');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.clock.runFor(500);
    await page.click('#panel-trainer .tr-score-actions button:has-text("60-second challenge")');
    for (let i = 0; i < 3; i++) {
      const pc = await page.evaluate(() => +document.querySelector('#panel-trainer .note').dataset.midi % 12);
      await page.click(`#panel-trainer .tr-answer[data-pc="${pc}"]`);
      await page.clock.runFor(400);
    }
    await page.clock.runFor(61000);
    check('[challenge] result', await page.textContent('#panel-trainer .tr-prompt-text'), /^⏱ Time! 3 correct out of 3 — new best!/);
    check('[challenge] best saved', await page.evaluate(() => String(JSON.parse(localStorage.getItem('fretbored:v1')).trainer.bestTimed.name)), '3');
    await ctx.close();
  }
  await browser.close();
  fs.unlinkSync(wav);

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n` + failures.join('\n'));
    process.exit(1);
  }
  console.log('\nBrowser smoke test passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
