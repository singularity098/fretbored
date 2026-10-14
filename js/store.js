/* Fretbored — settings persistence and a tiny event bus. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const KEY = 'fretbored:v1';

  const DEFAULTS = {
    tab: 'scales',
    theme: 'dark',
    fretboard: {
      strings: 6,
      tuning: 'std6',
      frets: 22,
      labels: 'notes',
      dots: 'aurora',
      wood: 'ebony',
      orientation: 'horizontal',
      lefty: false,
      customTunings: [],
    },
    scales: { root: 0, scaleId: 'major', pcs: null, category: 'common', lastScale: null },
    chords: { root: 0, chordId: 'maj', position: 0, advanced: false, showAll: false, custom: null },
    circle: { tonic: 0, mode: 0 },
    trainer: { from: 0, to: 12 },
    tuner: { mode: 'needle', target: 'instrument', a4: 440, lock: -1, sensitivity: 0.5 },
    metronome: {
      bpm: 100,
      beats: 4,
      noteValue: 4,
      levels: [3, 2, 2, 2],
      grouping: '',
      subdivision: 'none',
      sound: 'classic',
      volume: 0.8,
      subVolume: 0.5,
      gap: { on: false, play: 2, mute: 2 },
      trainer: { mode: 'off', start: 80, end: 120, step: 5, every: 4, rampBars: 32 },
    },
  };

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  // Merge saved values over defaults, keeping only keys whose type matches.
  function merge(def, saved) {
    if (!isObj(saved)) return structuredClone(def);
    const out = {};
    for (const k of Object.keys(def)) {
      const d = def[k];
      const v = saved[k];
      if (isObj(d)) out[k] = merge(d, v);
      else if (v === null && d === null) out[k] = null;
      else if (d === null) out[k] = v === undefined ? null : v;
      else if (Array.isArray(d)) out[k] = Array.isArray(v) ? v : structuredClone(d);
      else out[k] = typeof v === typeof d ? v : d;
    }
    return out;
  }

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {
    saved = null;
  }
  FS.settings = merge(DEFAULTS, saved);
  FS.DEFAULTS = DEFAULTS;

  let timer = null;
  FS.save = function () {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(FS.settings));
      } catch (e) {
        /* storage unavailable (private mode etc.) — settings just won't persist */
      }
    }, 150);
  };

  const listeners = {};
  FS.on = (evt, fn) => (listeners[evt] = listeners[evt] || []).push(fn);
  FS.emit = (evt, data) => (listeners[evt] || []).forEach((fn) => fn(data));

  /* ---- Tuning helpers ---- */

  FS.allTunings = function () {
    return FS.TUNINGS.concat(FS.settings.fretboard.customTunings || []);
  };

  FS.currentTuning = function () {
    const fb = FS.settings.fretboard;
    const all = FS.allTunings();
    let t = all.find((x) => x.id === fb.tuning && x.strings === fb.strings);
    if (!t) {
      t = all.find((x) => x.strings === fb.strings) || FS.TUNINGS[0];
      fb.tuning = t.id;
      fb.strings = t.strings;
    }
    return t;
  };

  FS.tuningLabel = function (t) {
    const names = t.flats ? FS.theory.FLAT : FS.theory.SHARP;
    return t.notes.map((m) => FS.theory.pretty(names[m % 12])).join(' ');
  };

  /* ---- Toast ---- */

  let toastTimer = null;
  FS.toast = function (msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  };

  /* ---- Small DOM helper ---- */

  FS.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };
})();
