/* Fretbored — music theory core: notes, spelling, scales, chords, matching, voicings. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const DEFAULT_LABELS = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
  // Conventional root names used to break spelling ties.
  const PREF_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PREF_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

  const mod12 = (n) => ((n % 12) + 12) % 12;
  const bit = (pc) => 1 << mod12(pc);
  const popcount = (m) => {
    let c = 0;
    while (m) { m &= m - 1; c++; }
    return c;
  };
  const maskOf = (ivs) => ivs.reduce((m, i) => m | bit(i), 0);
  // Rotate a 12-bit pitch-class mask so that pitch class p becomes p + n.
  const rotate = (mask, n) => {
    n = mod12(n);
    return ((mask << n) | (mask >>> (12 - n))) & 0xfff;
  };
  const pcsOf = (mask) => {
    const out = [];
    for (let i = 0; i < 12; i++) if (mask & (1 << i)) out.push(i);
    return out;
  };

  function pcOfName(name) {
    let pc = LETTER_PC[LETTERS.indexOf(name[0])];
    for (const ch of name.slice(1)) pc += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
    return mod12(pc);
  }

  function nameOn(letterIdx, pc) {
    let acc = mod12(pc - LETTER_PC[letterIdx]);
    if (acc > 6) acc -= 12;
    return LETTERS[letterIdx] + (acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc));
  }

  // 'Bb' -> 'B♭', 'b3' -> '♭3', 'm7b5' -> 'm7♭5'. Uppercase B is left alone.
  const pretty = (s) => (s ? String(s).replace(/#/g, '♯').replace(/b/g, '♭') : '');

  const midiName = (m) => SHARP[mod12(m)] + (Math.floor(m / 12) - 1);

  const degreeOffset = (label) => (parseInt(String(label).replace(/[^0-9]/g, ''), 10) - 1) % 7;

  function spellWith(rootName, intervals, labels) {
    const rl = LETTERS.indexOf(rootName[0]);
    const rpc = pcOfName(rootName);
    return intervals.map((iv, i) => nameOn((rl + degreeOffset(labels[i])) % 7, rpc + iv));
  }

  const accidentalCost = (names) =>
    names.reduce((c, n) => c + (n.length - 1) + (n.length > 2 ? 4 : 0), 0);

  const defaultLabels = (intervals) => intervals.map((i) => DEFAULT_LABELS[mod12(i)]);

  /**
   * Spell a set of intervals above a root, choosing the enharmonic root name that
   * gives the fewest accidentals. Returns { root, names } (names parallel to intervals).
   */
  function spell(rootPc, intervals, labels) {
    labels = labels || defaultLabels(intervals);
    const ivs = intervals.map(mod12);
    const minorish = ivs.includes(3) && !ivs.includes(4);
    const pref = (minorish ? PREF_MINOR : PREF_MAJOR)[mod12(rootPc)];
    const candidates = SHARP[rootPc] === FLAT[rootPc] ? [SHARP[rootPc]] : [SHARP[rootPc], FLAT[rootPc]];
    let best = null;
    for (const rn of candidates) {
      const names = spellWith(rn, intervals, labels);
      const cost = accidentalCost(names) + (rn === pref ? 0 : 0.5);
      if (!best || cost < best.cost) best = { cost, names, root: rn };
    }
    return { root: best.root, names: best.names };
  }

  // Display name for a bare pitch class (used for root buttons).
  const pcLabel = (pc) => (SHARP[pc] === FLAT[pc] ? SHARP[pc] : `${SHARP[pc]}/${FLAT[pc]}`);

  /* ---------------------------------------------------------------- Scales */

  // Labels for 7-note scales are derived by comparing each degree to the major scale.
  function heptatonicLabels(ivs) {
    return ivs.map((iv, i) => {
      const acc = iv - MAJOR[i];
      return (acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc)) + (i + 1);
    });
  }

  const SCALE_DEFS = [
    // Common
    ['major', 'Major (Ionian)', 'common', [0, 2, 4, 5, 7, 9, 11]],
    ['minor', 'Natural Minor (Aeolian)', 'common', [0, 2, 3, 5, 7, 8, 10]],
    ['majpent', 'Major Pentatonic', 'common', [0, 2, 4, 7, 9]],
    ['minpent', 'Minor Pentatonic', 'common', [0, 3, 5, 7, 10]],
    ['blues', 'Blues', 'common', [0, 3, 5, 6, 7, 10]],
    ['majblues', 'Major Blues', 'common', [0, 2, 3, 4, 7, 9]],
    ['dorian', 'Dorian', 'common', [0, 2, 3, 5, 7, 9, 10]],
    ['phrygian', 'Phrygian', 'common', [0, 1, 3, 5, 7, 8, 10]],
    ['lydian', 'Lydian', 'common', [0, 2, 4, 6, 7, 9, 11]],
    ['mixolydian', 'Mixolydian', 'common', [0, 2, 4, 5, 7, 9, 10]],
    ['locrian', 'Locrian', 'common', [0, 1, 3, 5, 6, 8, 10]],
    ['harmonicminor', 'Harmonic Minor', 'common', [0, 2, 3, 5, 7, 8, 11]],
    ['melodicminor', 'Melodic Minor', 'common', [0, 2, 3, 5, 7, 9, 11]],
    // Rare
    ['lydiandom', 'Lydian Dominant', 'rare', [0, 2, 4, 6, 7, 9, 10]],
    ['altered', 'Altered (Super Locrian)', 'rare', [0, 1, 3, 4, 6, 8, 10]],
    ['dorianb2', 'Dorian ♭2', 'rare', [0, 1, 3, 5, 7, 9, 10]],
    ['lydianaug', 'Lydian Augmented', 'rare', [0, 2, 4, 6, 8, 9, 11]],
    ['mixob6', 'Mixolydian ♭6', 'rare', [0, 2, 4, 5, 7, 8, 10]],
    ['locriannat2', 'Locrian ♮2 (Half-Diminished)', 'rare', [0, 2, 3, 5, 6, 8, 10]],
    ['locriannat6', 'Locrian ♮6', 'rare', [0, 1, 3, 5, 6, 9, 10]],
    ['ionianaug', 'Ionian ♯5', 'rare', [0, 2, 4, 5, 8, 9, 11]],
    ['lydiansharp2', 'Lydian ♯2', 'rare', [0, 3, 4, 6, 7, 9, 11]],
    ['ultralocrian', 'Ultra Locrian', 'rare', [0, 1, 3, 4, 6, 8, 9]],
    ['harmonicmajor', 'Harmonic Major', 'rare', [0, 2, 4, 5, 7, 8, 11]],
    ['wholetone', 'Whole Tone', 'rare', [0, 2, 4, 6, 8, 10], ['1', '2', '3', '#4', '#5', 'b7']],
    ['dimwh', 'Diminished (Whole-Half)', 'rare', [0, 2, 3, 5, 6, 8, 9, 11], ['1', '2', 'b3', '4', 'b5', 'b6', '6', '7']],
    ['dimhw', 'Diminished (Half-Whole)', 'rare', [0, 1, 3, 4, 6, 7, 9, 10], ['1', 'b2', '#2', '3', '#4', '5', '6', 'b7']],
    ['augmented', 'Augmented', 'rare', [0, 3, 4, 7, 8, 11], ['1', '#2', '3', '5', '#5', '7']],
    ['bebopdom', 'Bebop Dominant', 'rare', [0, 2, 4, 5, 7, 9, 10, 11], ['1', '2', '3', '4', '5', '6', 'b7', '7']],
    ['bebopmaj', 'Bebop Major', 'rare', [0, 2, 4, 5, 7, 8, 9, 11], ['1', '2', '3', '4', '5', '#5', '6', '7']],
    ['bebopdorian', 'Bebop Dorian', 'rare', [0, 2, 3, 4, 5, 7, 9, 10], ['1', '2', 'b3', '3', '4', '5', '6', 'b7']],
    ['chromatic', 'Chromatic', 'rare', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    // Exotic
    ['phrygiandom', 'Phrygian Dominant (Spanish)', 'exotic', [0, 1, 4, 5, 7, 8, 10]],
    ['doubleharmonic', 'Double Harmonic (Byzantine)', 'exotic', [0, 1, 4, 5, 7, 8, 11]],
    ['hungarianminor', 'Hungarian Minor', 'exotic', [0, 2, 3, 6, 7, 8, 11]],
    ['hungarianmajor', 'Hungarian Major', 'exotic', [0, 3, 4, 6, 7, 9, 10]],
    ['gypsy', 'Hungarian Gypsy', 'exotic', [0, 2, 3, 6, 7, 8, 10]],
    ['romanian', 'Romanian Minor (Ukrainian Dorian)', 'exotic', [0, 2, 3, 6, 7, 9, 10]],
    ['neapolitanminor', 'Neapolitan Minor', 'exotic', [0, 1, 3, 5, 7, 8, 11]],
    ['neapolitanmajor', 'Neapolitan Major', 'exotic', [0, 1, 3, 5, 7, 9, 11]],
    ['enigmatic', 'Enigmatic', 'exotic', [0, 1, 4, 6, 8, 10, 11]],
    ['persian', 'Persian', 'exotic', [0, 1, 4, 5, 6, 8, 11]],
    ['arabian', 'Arabian (Major Locrian)', 'exotic', [0, 2, 4, 5, 6, 8, 10]],
    ['oriental', 'Oriental', 'exotic', [0, 1, 4, 5, 6, 9, 10]],
    ['leadingwhole', 'Leading Whole Tone', 'exotic', [0, 2, 4, 6, 8, 10, 11]],
    ['spanish8', 'Spanish 8-Tone', 'exotic', [0, 1, 3, 4, 5, 6, 8, 10], ['1', 'b2', '#2', '3', '4', 'b5', 'b6', 'b7']],
    ['prometheus', 'Prometheus', 'exotic', [0, 2, 4, 6, 9, 10], ['1', '2', '3', '#4', '6', 'b7']],
    ['hirajoshi', 'Hirajoshi', 'exotic', [0, 2, 3, 7, 8]],
    ['insen', 'In Sen', 'exotic', [0, 1, 5, 7, 10]],
    ['iwato', 'Iwato', 'exotic', [0, 1, 5, 6, 10]],
    ['kumoi', 'Kumoi', 'exotic', [0, 2, 3, 7, 9]],
    ['pelog', 'Pelog', 'exotic', [0, 1, 3, 7, 8]],
    ['yo', 'Yo', 'exotic', [0, 2, 5, 7, 9]],
    ['egyptian', 'Egyptian (Suspended Pentatonic)', 'exotic', [0, 2, 5, 7, 10]],
    ['chinese', 'Chinese', 'exotic', [0, 4, 6, 7, 11], ['1', '3', '#4', '5', '7']],
  ];

  const SCALES = SCALE_DEFS.map(([id, name, category, intervals, labels]) => ({
    id,
    name,
    category,
    intervals,
    labels: labels || (intervals.length === 7 ? heptatonicLabels(intervals) : defaultLabels(intervals)),
    mask: maskOf(intervals),
  }));
  const SCALE_BY_ID = Object.fromEntries(SCALES.map((s) => [s.id, s]));
  const SCALE_BY_MASK = new Map(SCALES.map((s) => [s.mask, s]));
  const SCALE_CATEGORIES = [
    ['common', 'Common'],
    ['rare', 'Rare'],
    ['exotic', 'Exotic'],
  ];

  /**
   * Given an absolute pitch-class mask and a root, find the scale it forms.
   * Returns { exact, sameNotes: [{root, scale}], near: [{scale, added, removed}] }.
   */
  function matchScale(pcsMask, rootPc) {
    const rel = rotate(pcsMask, -rootPc);
    const exact = SCALE_BY_MASK.get(rel) || null;
    const sameNotes = [];
    for (const r of pcsOf(pcsMask)) {
      if (r === rootPc) continue;
      const s = SCALE_BY_MASK.get(rotate(pcsMask, -r));
      if (s) sameNotes.push({ root: r, scale: s });
    }
    const near = [];
    if (!exact) {
      for (const s of SCALES) {
        if (s.id === 'chromatic') continue;
        const diff = popcount(s.mask ^ rel);
        if (diff > 0 && diff <= 2) {
          near.push({
            scale: s,
            diff,
            added: pcsOf(s.mask & ~rel).map((i) => mod12(i + rootPc)),
            removed: pcsOf(rel & ~s.mask).map((i) => mod12(i + rootPc)),
          });
        }
      }
      const catRank = { common: 0, rare: 1, exotic: 2 };
      near.sort((a, b) => a.diff - b.diff || catRank[a.scale.category] - catRank[b.scale.category]);
    }
    return { exact, sameNotes, near: near.slice(0, 5) };
  }

  /* ---------------------------------------------------------------- Chords */

  // [id, symbol, button label, intervals, labels, optional intervals, basic?]
  const CHORD_DEFS = [
    ['maj', '', 'major', [0, 4, 7], ['1', '3', '5'], [], true],
    ['min', 'm', 'minor', [0, 3, 7], ['1', 'b3', '5'], [], true],
    ['7', '7', '7', [0, 4, 7, 10], ['1', '3', '5', 'b7'], [7], true],
    ['5', '5', '5', [0, 7], ['1', '5'], [], true],
    ['dim', 'dim', 'dim', [0, 3, 6], ['1', 'b3', 'b5'], [], true],
    ['dim7', 'dim7', 'dim7', [0, 3, 6, 9], ['1', 'b3', 'b5', 'bb7'], [], true],
    ['aug', 'aug', 'aug', [0, 4, 8], ['1', '3', '#5'], [], true],
    ['sus2', 'sus2', 'sus2', [0, 2, 7], ['1', '2', '5'], [], true],
    ['sus4', 'sus4', 'sus4', [0, 5, 7], ['1', '4', '5'], [], true],
    ['maj7', 'maj7', 'maj7', [0, 4, 7, 11], ['1', '3', '5', '7'], [7], true],
    ['m7', 'm7', 'm7', [0, 3, 7, 10], ['1', 'b3', '5', 'b7'], [7], true],
    ['7sus4', '7sus4', '7sus4', [0, 5, 7, 10], ['1', '4', '5', 'b7'], [], true],
    // Advanced
    ['6', '6', '6', [0, 4, 7, 9], ['1', '3', '5', '6'], [7]],
    ['m6', 'm6', 'm6', [0, 3, 7, 9], ['1', 'b3', '5', '6'], [7]],
    ['69', '6/9', '6/9', [0, 4, 7, 9, 2], ['1', '3', '5', '6', '9'], [7]],
    ['add9', 'add9', 'add9', [0, 4, 7, 2], ['1', '3', '5', '9'], []],
    ['madd9', 'm(add9)', 'm(add9)', [0, 3, 7, 2], ['1', 'b3', '5', '9'], []],
    ['add11', 'add11', 'add11', [0, 4, 7, 5], ['1', '3', '5', '11'], []],
    ['7sus2', '7sus2', '7sus2', [0, 2, 7, 10], ['1', '2', '5', 'b7'], []],
    ['m7b5', 'm7b5', 'm7♭5', [0, 3, 6, 10], ['1', 'b3', 'b5', 'b7'], []],
    ['mmaj7', 'm(maj7)', 'm(maj7)', [0, 3, 7, 11], ['1', 'b3', '5', '7'], []],
    ['7b5', '7b5', '7♭5', [0, 4, 6, 10], ['1', '3', 'b5', 'b7'], []],
    ['7s5', '7#5', '7♯5', [0, 4, 8, 10], ['1', '3', '#5', 'b7'], []],
    ['maj7s5', 'maj7#5', 'maj7♯5', [0, 4, 8, 11], ['1', '3', '#5', '7'], []],
    ['maj7b5', 'maj7b5', 'maj7♭5', [0, 4, 6, 11], ['1', '3', 'b5', '7'], []],
    ['9', '9', '9', [0, 4, 7, 10, 2], ['1', '3', '5', 'b7', '9'], [7]],
    ['maj9', 'maj9', 'maj9', [0, 4, 7, 11, 2], ['1', '3', '5', '7', '9'], [7]],
    ['m9', 'm9', 'm9', [0, 3, 7, 10, 2], ['1', 'b3', '5', 'b7', '9'], [7]],
    ['7b9', '7b9', '7♭9', [0, 4, 7, 10, 1], ['1', '3', '5', 'b7', 'b9'], [7]],
    ['7s9', '7#9', '7♯9', [0, 4, 7, 10, 3], ['1', '3', '5', 'b7', '#9'], [7]],
    ['9sus4', '9sus4', '9sus4', [0, 5, 7, 10, 2], ['1', '4', '5', 'b7', '9'], [7]],
    ['7s11', '7#11', '7♯11', [0, 4, 7, 10, 6], ['1', '3', '5', 'b7', '#11'], [7]],
    ['11', '11', '11', [0, 4, 7, 10, 2, 5], ['1', '3', '5', 'b7', '9', '11'], [7, 2]],
    ['m11', 'm11', 'm11', [0, 3, 7, 10, 2, 5], ['1', 'b3', '5', 'b7', '9', '11'], [7, 2]],
    ['13', '13', '13', [0, 4, 7, 10, 2, 9], ['1', '3', '5', 'b7', '9', '13'], [7, 2]],
    ['maj13', 'maj13', 'maj13', [0, 4, 7, 11, 2, 9], ['1', '3', '5', '7', '9', '13'], [7, 2]],
    ['m13', 'm13', 'm13', [0, 3, 7, 10, 2, 9], ['1', 'b3', '5', 'b7', '9', '13'], [7, 2]],
  ];

  const CHORDS = CHORD_DEFS.map(([id, symbol, label, intervals, labels, opt, basic]) => ({
    id,
    symbol,
    label,
    intervals,
    labels,
    basic: !!basic,
    mask: maskOf(intervals),
    optMask: maskOf(opt),
    // interval (0-11) -> label
    labelFor: Object.fromEntries(intervals.map((iv, i) => [mod12(iv), labels[i]])),
  }));
  const CHORD_BY_ID = Object.fromEntries(CHORDS.map((c) => [c.id, c]));

  /**
   * Identify a chord from an absolute pitch-class mask and its bass note.
   * Returns candidates best-first: [{ root, chord, omitted, score }].
   */
  function identifyChord(pcsMask, bassPc) {
    const out = [];
    if (popcount(pcsMask) < 2) return out;
    for (const r of pcsOf(pcsMask)) {
      const rel = rotate(pcsMask, -r);
      for (const c of CHORDS) {
        const req = c.mask & ~c.optMask;
        if ((rel & ~c.mask) !== 0 || (rel & req) !== req) continue;
        const omitted = popcount(c.mask & ~rel);
        let score = 10 - omitted * 3;
        if (r === bassPc) score += 6;
        if (c.basic) score += 1.5;
        score -= c.intervals.length * 0.2;
        out.push({ root: r, chord: c, omitted, score });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /**
   * Generate playable voicings of a chord for a tuning (array of open-string MIDI notes,
   * lowest string first). Returns voicings ordered up the neck:
   * [{ frets: [-1|0|n per string], base, score }].
   */
  function generateVoicings(tuning, numFrets, rootPc, chord) {
    const n = tuning.length;
    const full = chord.mask;
    const req = full & ~chord.optMask;
    const minPlayed = chord.id === '5' ? 2 : Math.min(n, Math.max(3, popcount(req)));
    const found = new Map();
    const frets = new Array(n).fill(-1);
    const relPc = (midi) => mod12(midi - rootPc);

    function evaluate() {
      let played = 0;
      let mask = 0;
      let opens = 0;
      const fretted = [];
      for (let s = 0; s < n; s++) {
        const f = frets[s];
        if (f < 0) continue;
        played++;
        mask |= bit(relPc(tuning[s] + f));
        if (f === 0) opens++;
        else fretted.push(s);
      }
      if (played < minPlayed || (mask & req) !== req) return;
      let minF = Infinity;
      let maxF = 0;
      for (const s of fretted) {
        minF = Math.min(minF, frets[s]);
        maxF = Math.max(maxF, frets[s]);
      }
      if (!fretted.length) minF = maxF = 0;
      let fingers = fretted.length;
      if (fingers > 4) {
        // Needs a barre across the lowest fret.
        const atMin = fretted.filter((s) => frets[s] === minF);
        if (atMin.length < 2) return;
        const barreFrom = atMin[0];
        for (let s = barreFrom + 1; s < n; s++) if (frets[s] === 0) return;
        fingers = 1 + fretted.filter((s) => frets[s] > minF).length;
        if (fingers > 4) return;
      }
      let topMuted = 0;
      for (let s = n - 1; s >= 0 && frets[s] < 0; s--) topMuted++;
      let lowMuted = 0;
      for (let s = 0; s < n && frets[s] < 0; s++) lowMuted++;
      const omitted = popcount(full & ~mask);
      const span = maxF - minF;
      let score;
      if (chord.id === '5') {
        // Power chords live on the low strings.
        if (lowMuted > Math.max(1, n - 4)) return;
        score = played * 0.1 - lowMuted * 0.6 - span * 0.5 + (maxF <= 4 ? opens * 0.2 : -opens * 0.3);
      } else {
        score =
          played * 1.0 -
          omitted * 1.0 -
          topMuted * 0.9 -
          lowMuted * 0.15 -
          span * 0.35 -
          (span >= 3 ? 0.8 : 0) +
          (maxF <= 4 ? opens * 0.25 : -opens * 0.3) -
          (fingers >= 4 ? 0.3 : 0);
      }
      const key = frets.join(',');
      if (!found.has(key)) found.set(key, { frets: frets.slice(), base: minF, score });
    }

    // phase: 0 = no string played yet, 1 = playing, 2 = finished (only mutes allowed after)
    function dfs(s, phase, opts) {
      if (s === n) {
        if (phase > 0) evaluate();
        return;
      }
      for (const f of opts[s]) {
        if (f < 0) {
          frets[s] = -1;
          dfs(s + 1, phase === 1 ? 2 : phase, opts);
        } else {
          if (phase === 2) continue;
          if (phase === 0 && relPc(tuning[s] + f) !== 0) continue; // bass must be the root
          frets[s] = f;
          dfs(s + 1, 1, opts);
        }
      }
      frets[s] = -1;
    }

    for (let lo = 1; lo <= numFrets; lo++) {
      const hi = Math.min(numFrets, lo + 3);
      const allowOpen = lo <= 4;
      const opts = tuning.map((open) => {
        const o = [-1];
        if (allowOpen && full & bit(relPc(open))) o.push(0);
        for (let f = lo; f <= hi; f++) if (full & bit(relPc(open + f))) o.push(f);
        return o;
      });
      dfs(0, 0, opts);
    }

    const all = [...found.values()];
    if (!all.length) return [];
    const byBase = new Map();
    for (const v of all) {
      const cur = byBase.get(v.base);
      if (!cur || v.score > cur.score) byBase.set(v.base, v);
    }
    const bestScore = Math.max(...all.map((v) => v.score));
    // Cluster neighbouring base frets into one position and keep the best voicing of each.
    const picked = [];
    let clusterStart = -Infinity;
    for (const b of [...byBase.keys()].sort((a, b2) => a - b2)) {
      const v = byBase.get(b);
      if (v.score < bestScore - 3) continue;
      if (b - clusterStart < 2 && picked.length) {
        if (v.score > picked[picked.length - 1].score) picked[picked.length - 1] = v;
      } else {
        clusterStart = b;
        picked.push(v);
      }
    }
    return picked;
  }

  /* ---------------------------------------------------------------- Arpeggios */

  /**
   * Arpeggio shapes: for each hand position (a 5-fret box; the open box is frets 0–4), every chord
   * tone in the box, each pitch once (a pitch reachable on two strings keeps the fret nearer the
   * middle of the box). Overlapping boxes are clustered and the fullest kept, giving positions up
   * the neck. Returns [{ lo, hi, notes: [{ s, f, midi, iv }] (ascending pitch), roots }].
   */
  // Chord tones of `chord` (rooted at rootPc) inside frets lo..hi, each pitch once: a duplicate
  // keeps the fret nearest the window centre (ties go to the lower fret, so open position uses
  // open strings). Open strings only count when the window starts at the nut.
  function boxNotes(tuning, rootPc, chord, lo, hi) {
    const mid = (lo + hi) / 2;
    const byPitch = new Map();
    for (let s = 0; s < tuning.length; s++) {
      for (let f = lo; f <= hi; f++) {
        if (lo > 0 && f === 0) continue;
        const midi = tuning[s] + f;
        const iv = mod12(midi - rootPc);
        if (!(chord.mask & bit(iv))) continue;
        const cur = byPitch.get(midi);
        const d = Math.abs(f - mid);
        const dc = cur && Math.abs(cur.f - mid);
        if (!cur || d < dc || (d === dc && f < cur.f)) byPitch.set(midi, { s, f, midi, iv });
      }
    }
    return [...byPitch.values()].sort((a, b) => a.midi - b.midi);
  }

  const hasAllTones = (notes, chord) => chord.intervals.every((iv) => notes.some((x) => x.iv === mod12(iv)));
  const shapeOf = (notes, extra) => {
    const frets = notes.map((x) => x.f);
    return { lo: Math.min(...frets), hi: Math.max(...frets), notes, roots: notes.filter((x) => x.iv === 0).length, key: notes.map((x) => `${x.s}:${x.f}`).join(' '), ...extra };
  };

  // Is the top of this tuning laid out like standard guitar tuning (4ths with a 3rd between G and B)?
  // Then the CAGED shape names apply.
  function isStandardLike(tuning) {
    const n = tuning.length;
    if (n < 6) return false;
    const steps = [];
    for (let s = n - 5; s < n; s++) steps.push(tuning[s] - tuning[s - 1]);
    return steps.join(',') === '5,5,5,4,5';
  }

  /*
   * Arpeggio positions, CAGED style: each shape is a fret window anchored on a root note — E and
   * G shapes on the 6th string, A and C on the 5th, D on the 4th (counted from the top six strings,
   * so 7/8-string guitars use the same layout) — filled with the chord tones in that window, each
   * pitch once. That gives the five standard positions per octave, e.g. for E major: E shape 0–4,
   * D 1–5, C 4–8, A 7–11, G 8–12. Shapes are named only in standard-like tunings.
   */
  const CAGED = [
    { name: 'E', str: 0, from: -1, to: 3 },
    { name: 'D', str: 2, from: -1, to: 3 },
    { name: 'C', str: 1, from: -3, to: 1 },
    { name: 'A', str: 1, from: 0, to: 4 },
    { name: 'G', str: 0, from: -4, to: 0 },
  ];
  function generateArpeggioShapes(tuning, numFrets, rootPc, chord) {
    const n = tuning.length;
    const base = Math.max(0, n - 6);
    const named = isStandardLike(tuning);
    const seen = new Set();
    const shapes = [];
    for (const a of CAGED) {
      const s = base + a.str;
      if (s >= n) continue;
      for (let R = 0; R <= numFrets; R++) {
        if (mod12(tuning[s] + R - rootPc) !== 0) continue;
        let lo = R + a.from;
        let hi = R + a.to; // five frets: R+from … R+to
        if (lo < 0) (hi -= lo), (lo = 0);
        hi = Math.min(hi, numFrets);
        const notes = boxNotes(tuning, rootPc, chord, lo, hi);
        // Skip stubs cut short by the last fret.
        if (notes.length < chord.intervals.length + 2 || !hasAllTones(notes, chord)) continue;
        const sh = shapeOf(notes, { kind: 'position', name: named ? `${a.name} shape` : '' });
        if (seen.has(sh.key)) continue;
        seen.add(sh.key);
        shapes.push(sh);
      }
    }
    // Unusual tunings or chords where no anchored window holds every tone: fall back to sliding boxes.
    if (!shapes.length) {
      for (let lo = 0; lo + 4 <= numFrets; lo++) {
        const notes = boxNotes(tuning, rootPc, chord, lo, lo + 4);
        if (!notes.some((x) => x.iv === 0) || !hasAllTones(notes, chord)) continue;
        const sh = shapeOf(notes, { kind: 'position', name: '' });
        if (seen.has(sh.key)) continue;
        seen.add(sh.key);
        shapes.push(sh);
      }
    }
    return shapes.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  }

  /*
   * Sweep-picking shapes: the chord tones climbed in pitch order, string by string, at most two
   * notes per string (the extra notes are the hammer-ons / pull-offs), within a 6-fret span.
   * - Root-anchored sweeps start on a root on any string with at least three strings above it and
   *   run to the top string, ending on a root, e.g. the 5-string E major from the A string:
   *   A 7·11, D 9, G 9, B 9, e 7·12.
   * - 3-string sweeps on the top three strings start on each chord tone and climb to its octave.
   * Two notes on a middle string are allowed (4-note chords need them) but avoided where possible.
   */
  function generateSweepShapes(tuning, numFrets, rootPc, chord) {
    const n = tuning.length;
    const top = n - 1;
    const isTone = (midi) => !!(chord.mask & bit(mod12(midi - rootPc)));
    const nextTone = (midi) => {
      for (let q = midi + 1; q <= midi + 12; q++) if (isTone(q)) return q;
      return null;
    };
    const MAX_SPAN = 6;
    const STRETCH = 5; // between two notes on one string

    // closeOn(note): where the sweep should end (a root, or the starting tone an octave up).
    // threeString: the classic 3-string layout is one note, one note, two notes at the top.
    function search(s0, f0, closeOn, threeString) {
      let best = null;
      const path = [{ s: s0, f: f0, midi: tuning[s0] + f0 }];
      const score = () => {
        const frets = path.map((x) => x.f);
        const span = Math.max(...frets) - Math.min(...frets);
        const counts = new Map();
        for (const x of path) counts.set(x.s, (counts.get(x.s) || 0) + 1);
        let middleDoubles = 0;
        for (const [s, c] of counts) if (c > 1 && s !== s0 && s !== top) middleDoubles++;
        const firstDouble = counts.get(s0) > 1;
        return -middleDoubles * 3 - Math.max(0, span - 5) * 2 + path.length * 0.3 + (threeString ? (firstDouble ? -2 : 0) : firstDouble ? 0.5 : 0);
      };
      const walk = () => {
        const last = path[path.length - 1];
        const frets = path.map((x) => x.f);
        if (last.s === top && closeOn(last)) {
          const notes = path.map((x) => ({ ...x, iv: mod12(x.midi - rootPc) }));
          if (hasAllTones(notes, chord)) {
            const sc = score();
            if (!best || sc > best.sc) best = { sc, notes };
          }
        }
        const p = nextTone(last.midi);
        if (p === null) return;
        const onString = path.filter((x) => x.s === last.s);
        const options = [];
        if (onString.length < 2) options.push({ s: last.s, f: p - tuning[last.s] });
        if (last.s < top) options.push({ s: last.s + 1, f: p - tuning[last.s + 1] });
        for (const o of options) {
          if (o.f < 0 || o.f > numFrets) continue;
          if (o.s === last.s && o.f - onString[0].f > STRETCH) continue;
          const lo = Math.min(...frets, o.f);
          const hi = Math.max(...frets, o.f);
          if (hi - lo > MAX_SPAN) continue;
          path.push({ s: o.s, f: o.f, midi: p });
          walk();
          path.pop();
        }
      };
      walk();
      return best;
    }

    const out = [];
    const seen = new Set();
    const add = (found, name, order) => {
      if (!found) return;
      const sh = shapeOf(found.notes, { kind: 'sweep', name, order });
      if (seen.has(sh.key)) return;
      seen.add(sh.key);
      out.push(sh);
    };
    for (let s = 0; s <= n - 4; s++) {
      for (let f = 0; f <= numFrets; f++) {
        if (mod12(tuning[s] + f - rootPc) !== 0) continue;
        add(search(s, f, (x) => mod12(x.midi - rootPc) === 0), `${n - s}-string sweep`, s);
      }
    }
    if (n >= 3) {
      for (let f = 0; f <= numFrets; f++) {
        const midi = tuning[n - 3] + f;
        if (!isTone(midi)) continue;
        add(search(n - 3, f, (x) => mod12(x.midi - midi) === 0 && x.midi > midi, true), '3-string sweep', n);
      }
    }
    // Drop a shape that is just part of a bigger one of the same kind.
    const keys = (sh) => new Set(sh.notes.map((x) => `${x.s}:${x.f}`));
    const kept = out.filter((a) => {
      const ka = keys(a);
      return !out.some((b) => b !== a && b.name === a.name && b.notes.length > a.notes.length && [...ka].every((k) => keys(b).has(k)));
    });
    return kept.sort((a, b) => a.order - b.order || a.lo - b.lo);
  }

  /* ---------------------------------------------------------------- Modes */

  const MODES = [
    { id: 'ionian', name: 'Ionian (Major)', short: 'Major', offset: 0 },
    { id: 'dorian', name: 'Dorian', short: 'Dorian', offset: 2 },
    { id: 'phrygian', name: 'Phrygian', short: 'Phrygian', offset: 4 },
    { id: 'lydian', name: 'Lydian', short: 'Lydian', offset: 5 },
    { id: 'mixolydian', name: 'Mixolydian', short: 'Mixolydian', offset: 7 },
    { id: 'aeolian', name: 'Aeolian (Minor)', short: 'Minor', offset: 9 },
    { id: 'locrian', name: 'Locrian', short: 'Locrian', offset: 11 },
  ];
  // Scale id in the scale library for each mode.
  const MODE_SCALE = ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'minor', 'locrian'];

  FS.theory = {
    LETTERS,
    SHARP,
    FLAT,
    DEFAULT_LABELS,
    mod12,
    bit,
    popcount,
    maskOf,
    rotate,
    pcsOf,
    pcOfName,
    nameOn,
    pretty,
    midiName,
    spell,
    pcLabel,
    defaultLabels,
    SCALES,
    SCALE_BY_ID,
    SCALE_CATEGORIES,
    matchScale,
    CHORDS,
    CHORD_BY_ID,
    identifyChord,
    generateVoicings,
    generateArpeggioShapes,
    generateSweepShapes,
    MODES,
    MODE_SCALE,
  };
})();
