// Run with: node tests/theory.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['theory.js', 'tunings.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const FS = ctx.window.FS;
const T = FS.theory;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL', name);
    console.error(e);
    process.exitCode = 1;
  }
}

test('scale interval sets are unique', () => {
  const seen = new Map();
  for (const s of T.SCALES) {
    assert(!seen.has(s.mask), `${s.id} duplicates ${seen.get(s.mask)}`);
    seen.set(s.mask, s.id);
    assert.strictEqual(s.labels.length, s.intervals.length, s.id);
  }
});

test('chord interval sets are unique', () => {
  const seen = new Map();
  for (const c of T.CHORDS) {
    assert(!seen.has(c.mask), `${c.id} duplicates ${seen.get(c.mask)}`);
    seen.set(c.mask, c.id);
  }
});

test('spelling', () => {
  const sp = (root, id) => {
    const s = T.SCALE_BY_ID[id];
    return T.spell(root, s.intervals, s.labels).names.join(' ');
  };
  assert.strictEqual(sp(0, 'major'), 'C D E F G A B');
  assert.strictEqual(sp(1, 'major'), 'Db Eb F Gb Ab Bb C');
  assert.strictEqual(sp(6, 'major'), 'F# G# A# B C# D# E#');
  assert.strictEqual(sp(8, 'minor'), 'G# A# B C# D# E F#');
  assert.strictEqual(sp(5, 'lydian'), 'F G A B C D E');
  assert.strictEqual(sp(9, 'blues'), 'A C D Eb E G');
  assert.strictEqual(sp(3, 'minpent'), 'Eb Gb Ab Bb Db');
  const c = T.CHORD_BY_ID['m7b5'];
  assert.strictEqual(T.spell(11, c.intervals, c.labels).names.join(' '), 'B D F A');
});

test('scale matching', () => {
  const C = T.maskOf([0, 2, 4, 5, 7, 9, 11]);
  assert.strictEqual(T.matchScale(C, 0).exact.id, 'major');
  assert.strictEqual(T.matchScale(C, 9).exact.id, 'minor');
  assert.strictEqual(T.matchScale(C, 2).exact.id, 'dorian');
  // C major with F# -> G major notes, C root = Lydian
  const lyd = (C & ~T.bit(5)) | T.bit(6);
  assert.strictEqual(T.matchScale(lyd, 0).exact.id, 'lydian');
  // Unknown set gives near matches
  const odd = T.maskOf([0, 1, 2, 7]);
  const m = T.matchScale(odd, 0);
  assert.strictEqual(m.exact, null);
});

test('chord identification', () => {
  const id = (pcs, bass) => {
    const r = T.identifyChord(T.maskOf(pcs), bass)[0];
    return r ? T.SHARP[r.root] + r.chord.symbol : null;
  };
  assert.strictEqual(id([0, 4, 7], 0), 'C');
  assert.strictEqual(id([9, 0, 4], 9), 'Am');
  assert.strictEqual(id([0, 4, 7, 9], 0), 'C6');
  assert.strictEqual(id([0, 4, 7, 9], 9), 'Am7');
  assert.strictEqual(id([7, 11, 2, 5], 7), 'G7');
  assert.strictEqual(id([0, 4, 7], 4), 'C'); // inversion: still C (shown as C/E)
  assert.strictEqual(id([0, 4, 10, 2], 0), 'C9'); // 5th omitted
});

test('voicings on standard guitar', () => {
  const std = FS.TUNINGS.find((t) => t.id === 'std6').notes;
  const v = (root, cid) => T.generateVoicings(std, 22, root, T.CHORD_BY_ID[cid]);
  const fmt = (x) => x.frets.map((f) => (f < 0 ? 'x' : f)).join('');
  const cMaj = v(0, 'maj');
  assert(cMaj.length >= 4, 'expected several C positions');
  assert.strictEqual(fmt(cMaj[0]), 'x32010');
  const eMaj = v(4, 'maj');
  assert.strictEqual(fmt(eMaj[0]), '022100');
  const gMaj = v(7, 'maj');
  assert.strictEqual(fmt(gMaj[0]), '320003');
  const aMin = v(9, 'min');
  assert.strictEqual(fmt(aMin[0]), 'x02210');
  for (const cid of Object.keys(T.CHORD_BY_ID)) {
    for (let r = 0; r < 12; r++) {
      const out = v(r, cid);
      assert(out.length > 0, `no voicing for ${r} ${cid}`);
    }
  }
  if (process.env.VERBOSE) {
    for (const cid of ['maj', 'min', '7', 'maj7', 'm7', '5', 'dim7', '13']) {
      console.log(cid, v(0, cid).map(fmt).join('  '));
    }
  }
});

test('voicings exist on every preset tuning for basic chords', () => {
  for (const t of FS.TUNINGS) {
    for (const c of T.CHORDS.filter((c) => c.basic)) {
      const out = T.generateVoicings(t.notes, 24, 0, c);
      assert(out.length > 0, `no voicing for C${c.symbol} in ${t.id}`);
    }
  }
});

console.log(`${passed} tests passed`);
