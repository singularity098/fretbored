/* Fretbored — Arpeggios tab: arpeggio shapes per position, with tablature and playback. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  // [id, label, seconds per note]. Shred ≈ 16th notes at 200 BPM, Max shred ≈ 16ths at 300 BPM.
  const SPEEDS = [
    ['slow', 'Slow', 0.42],
    ['medium', 'Medium', 0.26],
    ['fast', 'Fast', 0.16],
    ['faster', 'Faster', 0.11],
    ['shred', 'Shred', 0.075],
    ['maxshred', 'Max shred', 0.05],
  ];

  FS.initArpeggios = function (panel) {
    const t = FS.theory;
    const st = FS.settings.arpeggios;
    if (!t.CHORD_BY_ID[st.chordId]) st.chordId = 'maj';
    if (!['positions', 'sweep'].includes(st.style)) st.style = 'positions';
    if (!['up', 'down', 'updown'].includes(st.order)) st.order = 'updown';
    if (!SPEEDS.some((x) => x[0] === st.speed)) st.speed = 'medium';
    let scrollPending = true;
    let playing = null;
    // A custom shape (notes added/removed on the fretboard): st.custom = [[string, fret], …].
    if (st.custom && !(Array.isArray(st.custom) && st.custom.every((x) => Array.isArray(x) && x.length === 2 && x.every(Number.isInteger)))) st.custom = null;
    let unknown = false; // custom notes that match no arpeggio in the library

    /* ---- DOM ---- */
    const rootPills = h('div', { class: 'pills root-pills', role: 'group', 'aria-label': 'Root' });
    for (let pc = 0; pc < 12; pc++) {
      rootPills.append(h('button', { class: 'pill', dataset: { pc }, onclick: () => setArp(pc, st.chordId) }, t.pretty(t.pcLabel(pc))));
    }
    const basicPills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Arpeggio type' });
    const advPills = h('div', { class: 'pills advanced-pills', role: 'group', 'aria-label': 'Advanced arpeggio types' });
    for (const c of t.CHORDS) {
      (c.basic ? basicPills : advPills).append(h('button', { class: 'pill', dataset: { id: c.id }, onclick: () => setArp(st.root, c.id) }, c.label));
    }
    const advBtn = h('button', { class: 'btn ghost small', onclick: () => { st.advanced = !st.advanced; FS.save(); render(); } });
    // Positions: the five CAGED box shapes. Sweep: sweep-picking shapes (6/5/4-string from a root, 3-string).
    const styleSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Arpeggio style' });
    for (const [v, label] of [['positions', 'Positions'], ['sweep', 'Sweep']]) {
      styleSeg.append(h('button', { dataset: { v }, onclick: () => { if (st.style === v && !st.custom) return; st.style = v; st.position = 0; st.custom = null; unknown = false; scrollPending = true; FS.save(); render(); } }, label));
    }
    const posPills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Position' });
    const showAll = h('input', { type: 'checkbox', role: 'switch' });
    showAll.addEventListener('change', () => { st.showAll = showAll.checked; FS.save(); renderBoard(); });

    const orderSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Direction' });
    for (const [v, label] of [['up', 'Up'], ['down', 'Down'], ['updown', 'Up & down']]) {
      orderSeg.append(h('button', { dataset: { v }, onclick: () => { st.order = v; FS.save(); render(); } }, label));
    }
    const speedSeg = h('div', { class: 'seg speed-seg', role: 'group', 'aria-label': 'Playback speed' });
    for (const [v, label, step] of SPEEDS) {
      speedSeg.append(h('button', { dataset: { v }, title: `About ${Math.round(1 / step)} notes per second`, onclick: () => { st.speed = v; FS.save(); renderControls(); } }, label));
    }

    const title = h('h2', { class: 'hero-title' });
    const sub = h('div', { class: 'hero-sub' });
    const chips = h('div', { class: 'note-chips' });
    const alts = h('div', { class: 'match' });
    const tabHost = h('div', { class: 'tab-host', role: 'img' });

    const fbHost = h('div');

    panel.append(
      h('div', { class: 'card controls' },
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Root'), rootPills),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Type'), h('div', { class: 'stack' }, h('div', { class: 'inline wrap' }, basicPills, advBtn), advPills)),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Style'), styleSeg),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Shape'), h('div', { class: 'inline wrap' }, posPills,
          h('label', { class: 'field switch-field compact' }, h('span', { class: 'field-label' }, 'All arpeggio tones'), h('span', { class: 'switch' }, showAll, h('span', { class: 'slider' })))))
      ),
      h('div', { class: 'card hero arp-hero' },
        h('div', { class: 'hero-head' }, h('div', null, title, sub)),
        chips,
        alts,
        h('h3', { class: 'section-title' }, 'Tablature'),
        tabHost
      ),
      h('div', { class: 'card board-card' },
        fbHost,
        h('p', { class: 'hint' }, 'Tap the fretboard to add or remove notes — the arpeggio is named as you go · long-press (or right-click) a note to make it the root · numbers in the tab are frets, top line is the highest string')
      )
    );

    // The fretboard is always the first section on a tab (owner's layout rule).
    panel.prepend(panel.querySelector('.board-card'));
    const board = new FS.Fretboard(fbHost, { onToggle: tapNote, onRoot: rootNote });
    // Direction and speed live in Settings.
    FS.settingsHost('arpeggios').append(
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Direction'), orderSeg),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Speed'), speedSeg)
    );
    const nowBar = FS.createNowBar(panel, panel.querySelector('.arp-hero'), play);

    /* ---- Shapes ---- */

    let cacheKey = '';
    let shapes = [];
    function getShapes() {
      const tuning = FS.currentTuning().notes;
      const frets = FS.settings.fretboard.frets;
      const key = [tuning.join('.'), frets, st.root, st.chordId, st.style].join('|');
      if (key !== cacheKey) {
        cacheKey = key;
        const gen = st.style === 'sweep' ? t.generateSweepShapes : t.generateArpeggioShapes;
        shapes = gen(tuning, frets, st.root, t.CHORD_BY_ID[st.chordId]);
      }
      if (st.position >= shapes.length) st.position = 0;
      return shapes;
    }
    // The custom shape (if any) or the selected generated one.
    function currentShape() {
      if (st.custom) return customShape();
      return getShapes()[st.position] || null;
    }
    function customShape() {
      const tuning = FS.currentTuning().notes;
      const notes = st.custom
        .filter(([s, f]) => s >= 0 && s < tuning.length && f >= 0 && f <= FS.settings.fretboard.frets)
        .map(([s, f]) => ({ s, f, midi: tuning[s] + f, iv: t.mod12(tuning[s] + f - st.root) }))
        .sort((a, b) => a.midi - b.midi || a.s - b.s);
      if (!notes.length) return { kind: 'custom', name: 'Custom shape', notes, lo: 0, hi: 0, empty: true };
      const frets = notes.map((x) => x.f);
      return { kind: 'custom', name: 'Custom shape', notes, lo: Math.min(...frets), hi: Math.max(...frets) };
    }
    const customMask = () => customShape().notes.reduce((m, x) => m | t.bit(t.mod12(x.midi)), 0);
    const lowestPc = () => {
      const n = customShape().notes;
      return n.length ? t.mod12(n[0].midi) : null;
    };

    // Shape buttons: "A 7" = A shape from fret 7, "5-str 7" = 5-string sweep from fret 7; numbers when unnamed.
    const pillLabel = (sh, i) => {
      if (!sh.name) return String(i + 1);
      return sh.kind === 'sweep' ? `${sh.name.split('-')[0]}-str ${sh.lo}` : `${sh.name[0]} ${sh.lo}`;
    };
    // "position 2 (A shape)", "5-string sweep"
    const shapeLabel = (sh) => (sh.kind === 'custom' ? 'custom shape' : st.style === 'sweep' ? sh.name || `shape ${st.position + 1}` : `position ${st.position + 1}${sh.name ? ` (${sh.name})` : ''}`);

    // The order notes are played (and written in the tab).
    function sequence(shape) {
      if (!shape) return [];
      const up = shape.notes;
      if (st.order === 'down') return up.slice().reverse(); // highest note first
      return st.order === 'updown' ? up.concat(up.slice(0, -1).reverse()) : up.slice();
    }

    function spelled() {
      const c = t.CHORD_BY_ID[st.chordId];
      const sp = t.spell(st.root, c.intervals, c.labels);
      const nameOf = {};
      const ivOf = {};
      c.intervals.forEach((iv, i) => {
        nameOf[t.mod12(st.root + iv)] = sp.names[i];
        ivOf[t.mod12(st.root + iv)] = c.labels[i];
      });
      return { chord: c, root: sp.root, names: sp.names, nameOf, ivOf };
    }

    // "C major arpeggio", "Am7 arpeggio"
    const suffix = (c) => (c.id === 'maj' ? 'major arpeggio' : 'arpeggio');

    /* ---- State changes ---- */

    function setArp(root, id) {
      st.root = root;
      st.chordId = id;
      st.position = 0;
      st.custom = null;
      unknown = false;
      if (!t.CHORD_BY_ID[id].basic) st.advanced = true;
      scrollPending = true;
      FS.save();
      render();
    }

    // Tap: add the note to the shape, or remove it if it's already there; then identify the arpeggio.
    function tapNote(s, f) {
      const midi = FS.currentTuning().notes[s] + f;
      const cur = currentShape();
      const list = cur ? cur.notes.map((x) => [x.s, x.f]) : [];
      const i = list.findIndex(([a, b]) => a === s && b === f);
      if (i >= 0) list.splice(i, 1);
      else {
        list.push([s, f]);
        FS.audio.playNote(midi + bump(), FS.audio.ctx().currentTime + 0.02, 1.2, 0.5);
      }
      st.custom = list;
      identify();
      FS.save();
      render();
      if (i < 0) board.flash(midi, 300);
    }

    // Name the custom notes (lowest note preferred as the root, like the Chords tab).
    function identify(preferRoot) {
      const mask = customMask();
      const all = t.identifyChord(mask, lowestPc());
      const found = preferRoot === undefined ? all[0] : all.find((x) => x.root === preferRoot && x.omitted === 0) || all.find((x) => x.root === preferRoot);
      if (!found) {
        if (preferRoot === undefined) unknown = true;
        return false;
      }
      const changed = found.root !== st.root || found.chord.id !== st.chordId || unknown;
      st.root = found.root;
      st.chordId = found.chord.id;
      unknown = false;
      if (!found.chord.basic) st.advanced = true;
      if (changed) FS.toast(`Matched ${t.pretty(spelled().root + found.chord.symbol)} ${suffix(found.chord)}`);
      return true;
    }

    // Long-press / right-click: read the shape with this note as the root (e.g. C6 → Am7).
    function rootNote(s, f) {
      const pc = t.mod12(FS.currentTuning().notes[s] + f);
      if (!st.custom) {
        const cur = currentShape();
        st.custom = cur ? cur.notes.map((x) => [x.s, x.f]) : [];
      }
      if (!(customMask() & t.bit(pc))) {
        tapNote(s, f); // not in the shape yet: add it first
        if (!(customMask() & t.bit(pc))) return;
      }
      if (!identify(pc)) FS.toast(`No arpeggio with ${t.pretty(t.pcLabel(pc))} as the root fits these notes`);
      FS.save();
      render();
    }
    const bump = () => (FS.currentTuning().notes.length <= 5 ? 12 : 0); // bass is muddy on phone speakers

    /* ---- Playback ---- */

    function play() {
      const seq = sequence(currentShape());
      if (!seq.length) return;
      stopPlaying(); // pressing Play again starts over from the first note
      const step = (SPEEDS.find((x) => x[0] === st.speed) || SPEEDS[1])[2];
      FS.audio.prepare(seq.map((x) => x.midi + bump()));
      const ctx = FS.audio.ctx();
      const t0 = ctx.currentTime + 0.06;
      const timers = [];
      const notes = [];
      seq.forEach((x, i) => {
        const when = t0 + i * step;
        // The last note is as long as the others (it used to ring for 1.4 s, which sounded unnatural).
        notes.push(FS.audio.playNote(x.midi + bump(), when, step * 1.8, 0.5));
        timers.push(setTimeout(() => {
          board.flash(x.midi, step * 1000);
          highlightTab(i);
        }, (when - ctx.currentTime) * 1000));
      });
      timers.push(setTimeout(stopPlaying, (seq.length * step + 0.8) * 1000));
      playing = { timers, notes };
    }

    function stopPlaying() {
      if (!playing) return;
      playing.timers.forEach(clearTimeout);
      playing.notes.forEach(FS.audio.stopNote); // the notes are already queued: cut them too
      playing = null;
      highlightTab(-1);
    }

    /* ---- Rendering ---- */

    // The pinned bar's text is set by render(); its Play button is always labelled Play.
    let bar = null;
    function renderNowBar() {
      if (!bar) return;
      nowBar.set({ accent: bar.accent, rest: bar.rest, notes: bar.notes, action: bar.canPlay ? '▶ Play' : '' });
    }

    function renderControls() {
      const sp = spelled();
      rootPills.querySelectorAll('.pill').forEach((b) => {
        const active = +b.dataset.pc === st.root && !unknown;
        b.classList.toggle('active', active);
        b.textContent = active ? t.pretty(sp.root) : t.pretty(t.pcLabel(+b.dataset.pc));
      });
      [basicPills, advPills].forEach((g) => g.querySelectorAll('.pill').forEach((b) => b.classList.toggle('active', b.dataset.id === st.chordId && !unknown)));
      advPills.hidden = !st.advanced;
      advBtn.textContent = st.advanced ? 'Fewer types ▴' : 'Advanced ▾';
      showAll.checked = !!st.showAll;
      orderSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.order));
      styleSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.style));
      speedSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.speed));
    }

    function render() {
      const sp = spelled();
      const all = getShapes();
      const shape = currentShape();
      renderControls();

      posPills.innerHTML = '';
      all.forEach((x, i) => {
        posPills.append(
          h('button', {
            class: 'pill' + (!st.custom && i === st.position ? ' active' : ''),
            title: `${x.name ? `${x.name} · ` : ''}${x.lo === 0 ? `open position (frets 0–${x.hi})` : `frets ${x.lo}–${x.hi}`}`,
            onclick: () => { st.position = i; st.custom = null; unknown = false; scrollPending = true; FS.save(); render(); },
          }, pillLabel(x, i))
        );
      });
      if (st.custom) posPills.append(h('button', { class: 'pill active custom', title: 'Your own shape — pick a position to go back' }, 'Custom'));
      if (!all.length && !st.custom) posPills.append(h('span', { class: 'muted small' }, 'No shape fits this tuning — showing all arpeggio tones'));

      title.innerHTML = '';
      chips.innerHTML = '';
      alts.innerHTML = '';
      const where = shape && !shape.empty ? ` · ${shapeLabel(shape)}, ${shape.lo === 0 ? 'open' : `frets ${shape.lo}–${shape.hi}`} · ${shape.notes.length} note${shape.notes.length === 1 ? '' : 's'}` : '';
      const usedPcs = shape ? [...new Set(shape.notes.map((x) => t.mod12(x.midi)))] : [];
      if (unknown) {
        title.append(h('span', { class: 'accent-text' }, '?'), shape && shape.empty ? ' Empty shape' : ' Unknown arpeggio');
        sub.textContent = shape && shape.empty ? 'Tap the fretboard to add notes' : `These notes don’t match an arpeggio in the library${where}`;
        usedPcs.sort((a, b) => a - b).forEach((pc) => chips.append(h('div', { class: 'chip' }, h('span', { class: 'chip-note' }, t.pretty(t.pcLabel(pc))))));
      } else {
        title.append(h('span', { class: 'accent-text' }, t.pretty(sp.root + sp.chord.symbol)), ` ${suffix(sp.chord)}`);
        sub.textContent = `${sp.chord.labels.map(t.pretty).join(' ')}${where}`;
        sp.names.forEach((nm, i) => {
          const missing = st.custom && !usedPcs.includes(t.mod12(st.root + sp.chord.intervals[i]));
          chips.append(h('div', { class: 'chip' + (i === 0 ? ' root' : '') + (missing ? ' missing' : ''), title: missing ? 'Not in this shape' : '' }, h('span', { class: 'chip-note' }, t.pretty(nm)), h('span', { class: 'chip-iv' }, t.pretty(sp.chord.labels[i]))));
        });
        // Other names for the same notes (e.g. C6 = Am7) — long-press a note to switch.
        if (st.custom) {
          const others = t.identifyChord(customMask(), lowestPc()).filter((x) => !(x.root === st.root && x.chord.id === st.chordId) && x.omitted === 0);
          if (others.length) {
            alts.append(h('span', { class: 'match-label' }, 'Also'));
            for (const o of others.slice(0, 3)) {
              const rn = t.spell(o.root, o.chord.intervals, o.chord.labels).root;
              alts.append(h('button', { class: 'chip-btn', title: 'Use this name', onclick: () => { identify(o.root); FS.save(); render(); } }, t.pretty(rn + o.chord.symbol)));
            }
          }
        }
      }

      bar = {
        accent: unknown ? '?' : t.pretty(sp.root + sp.chord.symbol),
        rest: unknown ? 'Unknown arpeggio' : suffix(sp.chord),
        notes: (unknown ? usedPcs.map((pc) => t.pretty(t.pcLabel(pc))) : sp.names.map(t.pretty)).join('  ·  ') + (shape ? `   —   ${shapeLabel(shape)}` : ''),
        canPlay: !!shape && !shape.empty,
      };
      renderNowBar();

      renderTab(shape);
      renderBoard();
    }

    function renderBoard() {
      const sp = spelled();
      const tuning = FS.currentTuning().notes;
      const nFrets = FS.settings.fretboard.frets;
      const useIv = FS.settings.fretboard.labels === 'intervals';
      const shape = currentShape();
      const label = (pc) => (unknown || !sp.nameOf[pc] ? t.pretty(t.pcLabel(pc).split('/')[0]) : useIv ? sp.ivOf[pc] : sp.nameOf[pc]);
      const notes = [];
      const inShape = new Set();
      if (shape) {
        for (const x of shape.notes) {
          inShape.add(`${x.s}:${x.f}`);
          const pc = t.mod12(x.midi);
          notes.push({ s: x.s, f: x.f, kind: x.iv === 0 && !unknown ? 'root' : 'note', label: label(pc), iv: x.iv });
        }
      }
      if (!unknown && (st.showAll || !shape)) {
        const mask = t.rotate(sp.chord.mask, st.root);
        tuning.forEach((open, s) => {
          for (let f = 0; f <= nFrets; f++) {
            const pc = t.mod12(open + f);
            if (!(mask & t.bit(pc)) || inShape.has(`${s}:${f}`)) continue;
            notes.push({ s, f, kind: shape ? 'faint' : pc === st.root ? 'root' : 'note', label: label(pc), iv: t.mod12(pc - st.root) });
          }
        });
      }
      board.setModel({ notes, muted: [], focus: shape && !shape.empty && !st.custom ? { lo: shape.lo, hi: shape.hi } : null }); // vertical boards crop to it
      if (scrollPending && shape && fbHost.clientWidth) {
        scrollPending = false;
        board.scrollToFret(Math.round((shape.lo + shape.hi) / 2));
      }
    }

    // Tablature: one line per string (highest on top), fret numbers in playing order, wrapped.
    function renderTab(shape) {
      const seq = sequence(shape);
      tabHost.innerHTML = '';
      if (!seq.length) return;
      const tuning = FS.currentTuning();
      const n = tuning.notes.length;
      const names = (tuning.flats ? t.FLAT : t.SHARP).map(t.pretty);
      const lineGap = 19;
      const left = 36;
      const colW = 34;
      const width = Math.max(260, tabHost.clientWidth || 600);
      const perRow = Math.max(4, Math.floor((width - left - 16) / colW));
      const rows = [];
      for (let i = 0; i < seq.length; i += perRow) rows.push(seq.slice(i, i + perRow));
      const rowH = (n - 1) * lineGap + 34;
      const svgW = Math.min(width, left + 16 + Math.min(perRow, seq.length) * colW);
      const parts = [`<svg class="tab" width="${svgW}" height="${rows.length * rowH}" viewBox="0 0 ${svgW} ${rows.length * rowH}">`];
      const sp = spelled();
      rows.forEach((row, r) => {
        const y0 = r * rowH + 14;
        const x1 = left + row.length * colW + 10;
        for (let line = 0; line < n; line++) {
          const s = n - 1 - line; // highest string on top
          const y = y0 + line * lineGap;
          parts.push(`<text class="tab-str" x="${left - 12}" y="${y}">${names[t.mod12(tuning.notes[s])]}</text>`);
          parts.push(`<line class="tab-line" x1="${left - 4}" x2="${x1}" y1="${y}" y2="${y}"/>`);
        }
        parts.push(`<line class="tab-bar" x1="${left - 4}" x2="${left - 4}" y1="${y0}" y2="${y0 + (n - 1) * lineGap}"/>`);
        parts.push(`<line class="tab-bar" x1="${x1}" x2="${x1}" y1="${y0}" y2="${y0 + (n - 1) * lineGap}"/>`);
        row.forEach((x, i) => {
          const idx = r * perRow + i;
          const cx = left + 10 + i * colW + colW / 2 - 6;
          const y = y0 + (n - 1 - x.s) * lineGap;
          const txt = String(x.f);
          const w = txt.length * 9 + 8;
          const root = x.iv === 0 ? ' root' : '';
          parts.push(`<g class="tab-note${root}" data-i="${idx}"><rect x="${cx - w / 2}" y="${y - 9}" width="${w}" height="18" rx="4"/><text x="${cx}" y="${y}">${txt}</text></g>`);
        });
      });
      parts.push('</svg>');
      tabHost.innerHTML = parts.join('');
      tabHost.setAttribute('aria-label', `Tablature, ${st.order === 'updown' ? 'up and down' : st.order === 'down' ? 'descending' : 'ascending'}: ` + seq.map((x) => `string ${n - x.s} fret ${x.f}`).join(', '));
      tabHost.title = `Notes: ${seq.map((x) => t.pretty(sp.nameOf[t.mod12(x.midi)])).join(' ')}`;
    }

    function highlightTab(i) {
      tabHost.querySelectorAll('.tab-note.on').forEach((el) => el.classList.remove('on'));
      if (i >= 0) {
        const el = tabHost.querySelector(`.tab-note[data-i="${i}"]`);
        if (el) el.classList.add('on');
      }
    }

    let lastW = 0;
    new ResizeObserver(() => {
      const w = tabHost.clientWidth;
      if (Math.abs(w - lastW) > 20) {
        lastW = w;
        renderTab(currentShape());
      }
    }).observe(tabHost);

    let tuningKey = FS.currentTuning().notes.join('.');
    // A new tuning (different notes) ends a playing arpeggio; so does leaving the tab.
    FS.on('fretboard', () => {
      const k = FS.currentTuning().notes.join('.');
      if (k !== tuningKey) {
        stopPlaying();
        // A custom shape means different notes in another tuning.
        tuningKey = k;
        st.custom = null;
        unknown = false;
      }
      render();
    });
    if (st.custom) identify();
    FS.on('tab', (tab) => {
      if (tab !== 'arpeggios') stopPlaying();
    });
    render();
  };
})();
