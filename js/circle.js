/* Fretbored — Circle of Fifths tab. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);
  const NS = 'http://www.w3.org/2000/svg';

  const MAJ = ['C', 'G', 'D', 'A', 'E', 'B', 'F#/Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
  const MIN = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m/Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
  const DIM = ['B°', 'F#°', 'C#°', 'G#°', 'D#°', 'A#°', 'E#°', 'C°', 'G°', 'D°', 'A°', 'E°'];
  const SIG = ['', '1♯', '2♯', '3♯', '4♯', '5♯', '6♯/6♭', '5♭', '4♭', '3♭', '2♭', '1♭'];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const CHARACTER = {
    ionian: 'The bright, resolved major sound',
    dorian: 'Minor with a raised (♮) 6th — soulful and jazzy',
    phrygian: 'Minor with a ♭2 — dark, Spanish flavour',
    lydian: 'Major with a ♯4 — dreamy and floating',
    mixolydian: 'Major with a ♭7 — bluesy rock and folk',
    aeolian: 'The natural minor — sad and serious',
    locrian: 'Diminished tonic with ♭2 and ♭5 — unstable and tense',
  };

  const pos = (pc) => (pc * 7) % 12; // circle position of a pitch class
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  };
  function sector(r1, r2, a0, a1) {
    const rad = (a) => ((a - 90) * Math.PI) / 180;
    const p = (r, a) => `${(r * Math.cos(rad(a))).toFixed(2)} ${(r * Math.sin(rad(a))).toFixed(2)}`;
    return `M ${p(r2, a0)} A ${r2} ${r2} 0 0 1 ${p(r2, a1)} L ${p(r1, a1)} A ${r1} ${r1} 0 0 0 ${p(r1, a0)} Z`;
  }
  const polar = (r, a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [r * Math.cos(rad), r * Math.sin(rad)];
  };

  FS.initCircle = function (panel) {
    const t = FS.theory;
    const st = FS.settings.circle;
    const chordByMask = new Map(t.CHORDS.map((c) => [c.mask, c]));

    /* ---- Controls ---- */
    const keyPills = h('div', { class: 'pills root-pills', role: 'group', 'aria-label': 'Key' });
    for (let pc = 0; pc < 12; pc++) {
      keyPills.append(h('button', { class: 'pill', dataset: { pc }, onclick: () => set(pc, st.mode) }, t.pretty(t.pcLabel(pc))));
    }
    const modePills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Mode' });
    t.MODES.forEach((m, i) => modePills.append(h('button', { class: 'pill', dataset: { i }, onclick: () => set(st.tonic, i) }, m.name)));

    /* ---- SVG ---- */
    const svg = svgEl('svg', { viewBox: '-300 -300 600 600', class: 'circle-svg', role: 'img', 'aria-label': 'Circle of fifths' });
    const defs = svgEl('defs');
    defs.innerHTML = `<radialGradient id="cofcenter" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="var(--surface-2)"/><stop offset="1" stop-color="var(--surface)"/></radialGradient>
      <filter id="cofglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    svg.append(defs);
    const ring = (cls, r1, r2, labels, fontSize, onClick) => {
      const g = svgEl('g', { class: `cof-ring ${cls}` });
      const items = [];
      for (let k = 0; k < 12; k++) {
        const seg = svgEl('g', { class: 'cof-seg', tabindex: 0, role: 'button', 'aria-label': labels[k].replace('/', ' or ') });
        const path = svgEl('path', { d: sector(r1, r2, k * 30 - 15 + 0.6, k * 30 + 15 - 0.6) });
        const [x, y] = polar((r1 + r2) / 2, k * 30);
        const txt = svgEl('text', { x, y: y + fontSize * 0.1, 'font-size': fontSize });
        const lbl = labels[k];
        if (lbl.includes('/')) {
          const [a, b] = lbl.split('/');
          const t1 = svgEl('tspan', { x, dy: -fontSize * 0.45 });
          t1.textContent = t.pretty(a);
          const t2 = svgEl('tspan', { x, dy: fontSize * 0.95 });
          t2.textContent = t.pretty(b);
          txt.append(t1, t2);
          txt.setAttribute('font-size', fontSize * 0.78);
        } else txt.textContent = t.pretty(lbl);
        const num = svgEl('text', { x, y: y + fontSize * 0.95, class: 'cof-num' });
        seg.append(path, txt, num);
        seg.addEventListener('click', () => onClick(k));
        seg.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(k);
          }
        });
        g.append(seg);
        items.push({ seg, num });
      }
      svg.append(g);
      return items;
    };

    const sigRing = svgEl('g', { class: 'cof-sig' });
    for (let k = 0; k < 12; k++) {
      const [x, y] = polar(284, k * 30);
      const tx = svgEl('text', { x, y: y + 4 });
      tx.textContent = SIG[k];
      sigRing.append(tx);
    }
    svg.append(sigRing);

    // Each ring keeps the current mode only if that mode's tonic chord lives on the ring, so the
    // highlight lands on the segment that was clicked (Locrian's tonic is diminished: inner ring).
    const majorModes = [0, 3, 4]; // Ionian, Lydian, Mixolydian
    const minorModes = [1, 2, 5]; // Dorian, Phrygian, Aeolian
    const majors = ring('major', 196, 268, MAJ, 26, (k) => set((k * 7) % 12, majorModes.includes(st.mode) ? st.mode : 0));
    const minors = ring('minor', 140, 194, MIN, 17, (k) => set(((k * 7) % 12 + 9) % 12, minorModes.includes(st.mode) ? st.mode : 5));
    const dims = ring('dim', 104, 138, DIM, 13, (k) => set(((k * 7) % 12 + 11) % 12, 6));

    const center = svgEl('g', { class: 'cof-center' });
    center.append(svgEl('circle', { r: 98, fill: 'url(#cofcenter)' }));
    const cKey = svgEl('text', { y: -6, class: 'cof-key' });
    const cMode = svgEl('text', { y: 22, class: 'cof-mode' });
    const cSig = svgEl('text', { y: 48, class: 'cof-sigtext' });
    center.append(cKey, cMode, cSig);
    svg.append(center);

    /* ---- Info panel ---- */
    const infoTitle = h('h2', { class: 'hero-title' });
    const infoSub = h('div', { class: 'hero-sub' });
    const noteChips = h('div', { class: 'note-chips' });
    const chordTable = h('div', { class: 'chord-table' });
    const related = h('div', { class: 'related' });
    const openBtn = h('button', {
      class: 'btn',
      onclick: () => {
        FS.emit('scales:set', { root: st.tonic, scaleId: t.MODE_SCALE[st.mode] });
        FS.showTab('scales');
      },
    }, 'Show on fretboard →');

    // The wheel is the first section (owner's layout rule); key/mode controls and the info
    // panel sit beside it on desktop and below it on phones.
    panel.append(
      h('div', { class: 'circle-layout' },
        h('div', { class: 'card circle-card' }, svg),
        h('div', { class: 'circle-side' },
          h('div', { class: 'card controls' },
            h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Key'), keyPills),
            h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Mode'), modePills)
          ),
          h('div', { class: 'card info-card' },
            h('div', { class: 'hero-head' }, h('div', null, infoTitle, infoSub)),
            noteChips,
            h('h3', { class: 'section-title' }, 'Diatonic chords'),
            chordTable,
            related,
            h('div', { class: 'hero-actions' }, openBtn)
          )
        )
      )
    );

    const nowBar = FS.createNowBar(panel, panel.querySelector('.info-card .hero-head'), () => playScale());

    function set(tonic, mode) {
      st.tonic = tonic;
      st.mode = mode;
      FS.save();
      render();
    }

    function modeData() {
      const mode = t.MODES[st.mode];
      const scale = t.SCALE_BY_ID[t.MODE_SCALE[st.mode]];
      const sp = t.spell(st.tonic, scale.intervals, scale.labels);
      const ivs = scale.intervals;
      const degrees = ivs.map((iv, d) => {
        const stack = [0, 2, 4, 6].map((k) => t.mod12(ivs[(d + k) % 7] - iv));
        const triad = chordByMask.get(t.maskOf(stack.slice(0, 3)));
        const seventh = chordByMask.get(t.maskOf(stack));
        const lbl = scale.labels[d];
        const acc = lbl.replace(/[0-9]/g, '');
        let rn = ROMAN[d];
        if (triad.id === 'min' || triad.id === 'dim') rn = rn.toLowerCase();
        if (triad.id === 'dim') rn += '°';
        if (triad.id === 'aug') rn += '+';
        return { d, pc: t.mod12(st.tonic + iv), name: sp.names[d], triad, seventh, numeral: t.pretty(acc) + rn };
      });
      return { mode, scale, sp, degrees, parent: t.mod12(st.tonic - mode.offset) };
    }

    function render() {
      const md = modeData();
      const p = pos(md.parent);

      keyPills.querySelectorAll('.pill').forEach((b) => {
        const active = +b.dataset.pc === st.tonic;
        b.classList.toggle('active', active);
        b.textContent = active ? t.pretty(md.sp.root) : t.pretty(t.pcLabel(+b.dataset.pc));
      });
      modePills.querySelectorAll('.pill').forEach((b) => b.classList.toggle('active', +b.dataset.i === st.mode));

      // Highlight diatonic chords and label them with numerals relative to the tonic.
      const numFor = (pc, quality) => {
        const d = md.degrees.find((x) => x.pc === pc && x.triad.id === quality);
        return d ? d : null;
      };
      const mark = (items, k, pc, quality) => {
        const d = numFor(pc, quality);
        const on = !!d;
        items[k].seg.classList.toggle('on', on);
        items[k].seg.classList.toggle('tonic', on && d.d === 0);
        items[k].num.textContent = on ? d.numeral : '';
      };
      for (let k = 0; k < 12; k++) {
        const maj = (k * 7) % 12;
        mark(majors, k, maj, 'maj');
        mark(minors, k, t.mod12(maj + 9), 'min');
        mark(dims, k, t.mod12(maj + 11), 'dim');
      }
      sigRing.querySelectorAll('text').forEach((tx, k) => tx.classList.toggle('on', k === p));

      cKey.textContent = t.pretty(md.sp.root);
      cMode.textContent = md.mode.short;
      const parentName = t.spell(md.parent, t.SCALE_BY_ID.major.intervals, t.SCALE_BY_ID.major.labels).root;
      cSig.textContent = !SIG[p] ? 'no ♯ / ♭' : SIG[p].includes('/') ? SIG[p].split('/')[parentName.includes('b') ? 1 : 0] : SIG[p];

      nowBar.set({
        accent: t.pretty(md.sp.root),
        rest: md.mode.name,
        notes: md.sp.names.map(t.pretty).join('  ·  '),
        action: '▶ Play scale',
      });

      infoTitle.innerHTML = '';
      infoTitle.append(h('span', { class: 'accent-text' }, t.pretty(md.sp.root)), ' ', md.mode.name);
      infoSub.textContent = CHARACTER[md.mode.id];

      noteChips.innerHTML = '';
      md.sp.names.forEach((nm, i) =>
        noteChips.append(h('div', { class: 'chip' + (i === 0 ? ' root' : '') }, h('span', { class: 'chip-note' }, t.pretty(nm)), h('span', { class: 'chip-iv' }, t.pretty(md.scale.labels[i]))))
      );

      chordTable.innerHTML = '';
      for (const d of md.degrees) {
        chordTable.append(
          h('button', { class: 'chord-cell' + (d.d === 0 ? ' tonic' : ''), title: 'Play', onclick: () => playChord(d) },
            h('span', { class: 'numeral' }, d.numeral),
            h('span', { class: 'triad' }, t.pretty(d.name + d.triad.symbol)),
            h('span', { class: 'seventh' }, d.seventh ? t.pretty(d.name + d.seventh.symbol) : '')
          )
        );
      }

      // Related keys
      const relMinorPc = t.mod12(md.parent + 9);
      const relMinor = t.spell(relMinorPc, t.SCALE_BY_ID.minor.intervals, t.SCALE_BY_ID.minor.labels).root;
      related.innerHTML = '';
      const sigNames = keySignature(md.parent);
      related.append(
        h('div', { class: 'kv' }, h('span', null, 'Key signature'), h('strong', null, sigNames || 'No sharps or flats')),
        h('div', { class: 'kv' }, h('span', null, 'Relative major / minor'), h('strong', null, `${t.pretty(parentName)} major · ${t.pretty(relMinor)} minor`)),
        h('div', { class: 'kv' }, h('span', null, 'Neighbours'),
          h('strong', null, `${t.pretty(nameAt(p - 1))} (IV) · ${t.pretty(nameAt(p + 1))} (V) of ${t.pretty(parentName)}`))
      );
    }

    function nameAt(k) {
      const pc = (((k % 12) + 12) % 12) * 7 % 12;
      return t.spell(pc, t.SCALE_BY_ID.major.intervals, t.SCALE_BY_ID.major.labels).root;
    }

    function keySignature(parentPc) {
      const sp = t.spell(parentPc, t.SCALE_BY_ID.major.intervals, t.SCALE_BY_ID.major.labels);
      const sharpOrder = ['F#', 'C#', 'G#', 'D#', 'A#', 'E#', 'B#'];
      const flatOrder = ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Fb'];
      const acc = sp.names.filter((n) => n.length > 1);
      if (!acc.length) return '';
      const order = acc[0].includes('#') ? sharpOrder : flatOrder;
      return acc.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(t.pretty).join(' ');
    }

    function playScale() {
      const ctx = FS.audio.ctx();
      const md = modeData();
      const base = 52 + t.mod12(st.tonic - 4);
      FS.audio.prepare(md.scale.intervals.concat(12).map((iv) => base + iv));
      const t0 = ctx.currentTime + 0.05;
      md.scale.intervals.concat(12).forEach((iv, i) => FS.audio.playNote(base + iv, t0 + i * 0.28, 0.45, 0.55));
    }

    function playChord(d) {
      const ctx = FS.audio.ctx();
      const c = d.seventh || d.triad;
      const base = 48 + d.pc;
      FS.audio.prepare(c.intervals.map((iv) => base + iv));
      const t0 = ctx.currentTime + 0.04;
      c.intervals.forEach((iv, i) => FS.audio.playNote(base + iv, t0 + i * 0.035, 1.6, 0.35));
    }

    render();
  };
})();
