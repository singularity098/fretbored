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

    // Circle of fifths: D Dorian.
    await page.click('#tab-circle');
    await page.waitForTimeout(250);
    await page.click('#panel-circle .pill:has-text("Dorian")');
    await page.waitForTimeout(150);
    check(`${P} circle: C Dorian`, await page.textContent('#panel-circle .hero-title'), 'C Dorian');
    await shot('circle');

    // Trainer: name mode scoring, fret range, strings, naturals, find mode, saved progress.
    await page.click('#tab-trainer');
    await page.waitForTimeout(250);
    const trPrompt = () => page.textContent('#panel-trainer .tr-prompt-text');
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
    await page.click('.start-btn');
    const beatGaps = await page.evaluate(() => window.__beats.slice(1).map((t, i) => Math.round((t - window.__beats[i]) * 1000)));
    check(`${P} metronome: beats 500 ms apart at 120 BPM`, String([...new Set(beatGaps)]), '500');
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
