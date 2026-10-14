// Run with: node tests/pitch.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pitch.js'), 'utf8'), ctx);
const P = ctx.window.FS.pitch;

const SR = 48000;
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// A plucked-string-like tone: fundamental plus decaying harmonics, optional noise.
function tone(freq, n, opts = {}) {
  const out = new Float32Array(n);
  const harmonics = opts.harmonics || [1, 0.6, 0.4, 0.25, 0.15];
  const phase0 = opts.phase || 0.3;
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((amp, h) => {
      v += amp * Math.sin(2 * Math.PI * freq * (h + 1) * (i / SR) + phase0 * (h + 1));
    });
    out[i] = v * 0.2 + (opts.noise || 0) * rand();
  }
  return out;
}

const cents = (f, ref) => 1200 * Math.log2(f / ref);
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL', name);
    console.error(e.message);
    process.exitCode = 1;
  }
}

test('FFT round-trips', () => {
  const fft = P.makeFFT(16);
  const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i));
  const orig = re.slice();
  const im = new Float64Array(16);
  fft(re, im, false);
  fft(re, im, true);
  for (let i = 0; i < 16; i++) assert(Math.abs(re[i] - orig[i]) < 1e-9);
});

const cases = [
  ['bass B0', 30.87, 8192],
  ['bass E1', 41.2, 8192],
  ['guitar low E2', 82.41, 4096],
  ['guitar A2', 110, 4096],
  ['guitar D3 +7c', 146.83 * Math.pow(2, 7 / 1200), 4096],
  ['guitar G3 -13c', 196 * Math.pow(2, -13 / 1200), 4096],
  ['guitar B3', 246.94, 4096],
  ['guitar high E4', 329.63, 4096],
  ['fret 24 E6', 1318.5, 4096],
];
for (const [name, f, size] of cases) {
  test(`${name} within 0.5 cent`, () => {
    const det = P.createDetector(size);
    const r = det(tone(f, size), SR, 25, 1500);
    assert(r.freq > 0, 'no pitch');
    const c = cents(r.freq, f);
    assert(Math.abs(c) < 0.5, `off by ${c.toFixed(3)} cents (got ${r.freq.toFixed(3)} Hz)`);
    assert(r.clarity > 0.9, `clarity ${r.clarity}`);
  });
}

test('weak fundamental does not cause an octave error', () => {
  const det = P.createDetector(4096);
  const r = det(tone(82.41, 4096, { harmonics: [0.15, 1, 0.7, 0.5, 0.3] }), SR, 25, 1500);
  assert(Math.abs(cents(r.freq, 82.41)) < 1, `got ${r.freq}`);
});

test('noisy signal: median of 7 frames (as the tuner smooths) within 1 cent', () => {
  const det = P.createDetector(4096);
  const got = [];
  for (let k = 0; k < 7; k++) got.push(det(tone(110, 4096, { noise: 0.05, phase: k }), SR, 25, 1500).freq);
  got.sort((a, b) => a - b);
  assert(Math.abs(cents(got[3], 110)) < 1, `got ${got[3]}`);
});

test('pure noise has low clarity', () => {
  const det = P.createDetector(4096);
  const n = Float32Array.from({ length: 4096 }, () => rand() * 0.1);
  const r = det(n, SR, 25, 1500);
  assert(r.clarity < 0.7, `clarity ${r.clarity}`);
});

test('silence reports nothing', () => {
  const det = P.createDetector(4096);
  const r = det(new Float32Array(4096), SR, 25, 1500);
  assert.strictEqual(r.freq, 0);
});

console.log(`${passed} pitch tests passed`);
