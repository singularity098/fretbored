/* Fretbored — Guitar Chords tab. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  FS.initChords = function (panel) {
    const t = FS.theory;
    const st = FS.settings.chords;
    if (!t.CHORD_BY_ID[st.chordId]) st.chordId = 'maj';
    let unknown = false; // custom voicing that matches no chord
    let scrollPending = true; // bring a newly chosen voicing into view

    /* ---- DOM ---- */
    const rootPills = h('div', { class: 'pills root-pills', role: 'group', 'aria-label': 'Root' });
    for (let pc = 0; pc < 12; pc++) {
      rootPills.append(h('button', { class: 'pill', dataset: { pc }, onclick: () => setChord(pc, st.chordId) }, t.pretty(t.pcLabel(pc))));
    }
    const basicPills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Chord type' });
    const advPills = h('div', { class: 'pills advanced-pills', role: 'group', 'aria-label': 'Advanced chord types' });
    for (const c of t.CHORDS) {
      (c.basic ? basicPills : advPills).append(
        h('button', { class: 'pill', dataset: { id: c.id }, onclick: () => setChord(st.root, c.id) }, c.label)
      );
    }
    const advBtn = h('button', { class: 'btn ghost small', 'aria-expanded': 'false', onclick: () => { st.advanced = !st.advanced; FS.save(); render(); } });
    const posPills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Position' });
    const showAll = h('input', { type: 'checkbox', role: 'switch' });
    showAll.addEventListener('change', () => { st.showAll = showAll.checked; FS.save(); renderBoard(); });

    const title = h('h2', { class: 'hero-title' });
    const sub = h('div', { class: 'hero-sub' });
    const chips = h('div', { class: 'note-chips' });
    const alts = h('div', { class: 'match' });
    const box = h('div', { class: 'chord-box' });

    const fbControls = h('div');
    const fbHost = h('div');

    panel.append(
      h('div', { class: 'card controls' },
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Root'), rootPills),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Type'), h('div', { class: 'stack' }, h('div', { class: 'inline wrap' }, basicPills, advBtn), advPills)),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Position'), h('div', { class: 'inline wrap' }, posPills,
          h('label', { class: 'field switch-field compact' }, h('span', { class: 'field-label' }, 'All chord tones'), h('span', { class: 'switch' }, showAll, h('span', { class: 'slider' })))))
      ),
      h('div', { class: 'card hero chord-hero' },
        h('div', { class: 'hero-main' },
          h('div', { class: 'hero-head' }, h('div', null, title, sub)),
          chips,
          alts
        ),
        box
      ),
      h('div', { class: 'card board-card' },
        fbControls,
        fbHost,
        h('p', { class: 'hint' }, 'Tap a fret to move that string’s note there · tap a played note again to mute the string')
      )
    );

    // The fretboard is always the first section on a tab (owner's layout rule).
    panel.prepend(panel.querySelector('.board-card'));
    FS.createFretboardControls(fbControls);
    const board = new FS.Fretboard(fbHost, { onToggle: edit, onRoot: edit });
    const nowBar = FS.createNowBar(panel, panel.querySelector('.chord-hero'), () => strum());

    /* ---- Voicings ---- */

    let cacheKey = '';
    let voicings = [];
    function getVoicings() {
      const tuning = FS.currentTuning().notes;
      const frets = FS.settings.fretboard.frets;
      const key = [tuning.join('.'), frets, st.root, st.chordId].join('|');
      if (key !== cacheKey) {
        cacheKey = key;
        voicings = t.generateVoicings(tuning, frets, st.root, t.CHORD_BY_ID[st.chordId]);
      }
      return voicings;
    }

    function currentFrets() {
      const n = FS.currentTuning().notes.length;
      if (st.custom && st.custom.length === n) return st.custom;
      st.custom = null;
      const v = getVoicings();
      if (!v.length) return null;
      if (st.position >= v.length) st.position = 0;
      return v[st.position].frets;
    }

    /* ---- State changes ---- */

    function setChord(root, id) {
      st.root = root;
      st.chordId = id;
      st.custom = null;
      st.position = 0;
      unknown = false;
      scrollPending = true;
      if (!t.CHORD_BY_ID[id].basic) st.advanced = true;
      FS.save();
      render();
    }

    function edit(s, f) {
      const tuning = FS.currentTuning().notes;
      const fr = (currentFrets() || new Array(tuning.length).fill(-1)).slice();
      fr[s] = fr[s] === f ? -1 : f;
      st.custom = fr;
      let mask = 0;
      let bass = null;
      fr.forEach((x, i) => {
        if (x < 0) return;
        const pc = t.mod12(tuning[i] + x);
        mask |= t.bit(pc);
        if (bass === null) bass = pc;
      });
      const found = t.identifyChord(mask, bass)[0];
      if (found) {
        const changed = found.root !== st.root || found.chord.id !== st.chordId;
        st.root = found.root;
        st.chordId = found.chord.id;
        unknown = false;
        if (!found.chord.basic) st.advanced = true;
        if (changed) FS.toast(`Matched ${chordName()}`);
      } else unknown = true;
      FS.save();
      render();
    }

    /* ---- Naming / spelling ---- */

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

    function bassPc(fr) {
      const tuning = FS.currentTuning().notes;
      if (!fr) return null;
      const s = fr.findIndex((x) => x >= 0);
      return s < 0 ? null : t.mod12(tuning[s] + fr[s]);
    }

    function chordName() {
      const sp = spelled();
      let name = t.pretty(sp.root + sp.chord.symbol);
      const b = bassPc(currentFrets());
      if (b !== null && b !== st.root) {
        name += '/' + t.pretty(sp.nameOf[b] || t.pcLabel(b).split('/')[0]);
      }
      return name;
    }

    /* ---- Rendering ---- */

    function render() {
      const sp = spelled();
      const fr = currentFrets();
      const v = getVoicings();

      rootPills.querySelectorAll('.pill').forEach((b) => {
        const active = +b.dataset.pc === st.root && !unknown;
        b.classList.toggle('active', active);
        b.textContent = active ? t.pretty(sp.root) : t.pretty(t.pcLabel(+b.dataset.pc));
      });
      [basicPills, advPills].forEach((g) =>
        g.querySelectorAll('.pill').forEach((b) => b.classList.toggle('active', b.dataset.id === st.chordId && !unknown))
      );
      advPills.hidden = !st.advanced;
      advBtn.textContent = st.advanced ? 'Fewer chords ▴' : 'Advanced ▾';
      advBtn.setAttribute('aria-expanded', String(!!st.advanced));
      showAll.checked = !!st.showAll;

      posPills.innerHTML = '';
      v.forEach((x, i) => {
        posPills.append(
          h('button', {
            class: 'pill' + (!st.custom && i === st.position ? ' active' : ''),
            title: x.base ? `Around fret ${x.base}` : 'Open position',
            onclick: () => { st.position = i; st.custom = null; unknown = false; scrollPending = true; FS.save(); render(); },
          }, String(i + 1))
        );
      });
      if (st.custom) posPills.append(h('button', { class: 'pill active custom' }, 'Custom'));
      if (!v.length && !st.custom) posPills.append(h('span', { class: 'muted small' }, 'No playable shape in this tuning — showing all chord tones'));

      const tuning = FS.currentTuning().notes;
      const played = fr ? fr.map((x, i) => (x < 0 ? null : tuning[i] + x)).filter((x) => x !== null) : [];
      const playedPcs = [...new Set(played.map(t.mod12))];

      title.innerHTML = '';
      chips.innerHTML = '';
      alts.innerHTML = '';
      if (unknown) {
        title.append(h('span', { class: 'accent-text' }, '?'), ' Unknown chord');
        sub.textContent = 'These notes don’t match a chord in the library';
        playedPcs.forEach((pc) => chips.append(h('div', { class: 'chip' }, h('span', { class: 'chip-note' }, t.pretty(t.pcLabel(pc))))));
      } else {
        title.append(h('span', { class: 'accent-text' }, chordName()));
        sub.textContent = `${sp.chord.label === 'major' ? 'major' : sp.chord.label === 'minor' ? 'minor' : sp.chord.label} · ${sp.chord.labels.map(t.pretty).join(' ')}`;
        sp.names.forEach((nm, i) => {
          const pc = t.mod12(st.root + sp.chord.intervals[i]);
          const missing = fr && !playedPcs.includes(pc);
          chips.append(
            h('div', { class: 'chip' + (i === 0 ? ' root' : '') + (missing ? ' missing' : ''), title: missing ? 'Omitted in this voicing' : '' },
              h('span', { class: 'chip-note' }, t.pretty(nm)), h('span', { class: 'chip-iv' }, t.pretty(sp.chord.labels[i])))
          );
        });
        // Other names for the same notes (e.g. C6 = Am7/C)
        if (fr) {
          let mask = 0;
          playedPcs.forEach((pc) => (mask |= t.bit(pc)));
          const others = t.identifyChord(mask, bassPc(fr)).filter((x) => !(x.root === st.root && x.chord.id === st.chordId) && x.omitted === 0);
          if (others.length) {
            alts.append(h('span', { class: 'match-label' }, 'Also'));
            for (const o of others.slice(0, 3)) {
              const rn = t.spell(o.root, o.chord.intervals, o.chord.labels).root;
              const b = bassPc(fr);
              const slash = b !== o.root ? '/' + t.pretty(t.pcLabel(b).split('/')[0]) : '';
              alts.append(h('span', { class: 'chip-btn static' }, t.pretty(rn + o.chord.symbol) + slash));
            }
          }
        }
      }

      const pos = st.custom ? 'Custom shape' : v.length ? `Position ${st.position + 1}` : '';
      nowBar.set({
        accent: unknown ? '?' : chordName(),
        rest: unknown ? 'Unknown chord' : spelled().chord.id === 'maj' ? 'major' : '',
        notes: (unknown ? playedPcs.map((pc) => t.pretty(t.pcLabel(pc).split('/')[0])) : sp.names.map(t.pretty)).join('  ·  ') + (pos ? `   —   ${pos}` : ''),
        action: fr ? '▶ Strum' : '',
      });

      renderBox(fr);
      renderBoard();
    }

    function renderBoard() {
      const sp = spelled();
      const tuning = FS.currentTuning().notes;
      const nFrets = FS.settings.fretboard.frets;
      const useIv = FS.settings.fretboard.labels === 'intervals';
      const fr = currentFrets();
      const notes = [];
      const muted = [];
      const labelFor = (pc) => {
        if (!unknown && sp.nameOf[pc]) return useIv ? sp.ivOf[pc] : sp.nameOf[pc];
        return useIv ? t.DEFAULT_LABELS[t.mod12(pc - st.root)] : t.pcLabel(pc).split('/')[0];
      };
      const kindFor = (pc) => (!unknown && pc === st.root ? 'root' : 'note');
      if (fr) {
        fr.forEach((f, s) => {
          if (f < 0) muted.push(s);
          else {
            const pc = t.mod12(tuning[s] + f);
            notes.push({ s, f, kind: kindFor(pc), label: labelFor(pc), iv: t.mod12(pc - st.root) });
          }
        });
      }
      if (st.showAll || !fr) {
        const mask = t.rotate(sp.chord.mask, st.root);
        tuning.forEach((open, s) => {
          for (let f = 0; f <= nFrets; f++) {
            const pc = t.mod12(open + f);
            if (!(mask & t.bit(pc)) || (fr && fr[s] === f)) continue;
            if (fr && f === 0 && fr[s] < 0) continue; // keep the mute marker readable
            notes.push({ s, f, kind: fr ? 'faint' : kindFor(pc), label: labelFor(pc), iv: t.mod12(pc - st.root) });
          }
        });
      }
      // Vertical boards crop to the shape's frets (see Fretboard.cropRange).
      const used = fr ? fr.filter((x) => x > 0) : [];
      const focus = fr ? { lo: used.length ? Math.min(...used) : 0, hi: used.length ? Math.max(...used) : 0 } : null;
      board.setModel({ notes, muted, focus });
      if (scrollPending && fr && fbHost.clientWidth) {
        scrollPending = false;
        const fretted = fr.filter((x) => x > 0);
        board.scrollToFret(fretted.length ? Math.round((Math.min(...fretted) + Math.max(...fretted)) / 2) : 0);
      }
    }

    // Compact vertical chord diagram.
    function renderBox(fr) {
      if (!fr) {
        box.innerHTML = '';
        return;
      }
      const tuning = FS.currentTuning().notes;
      const n = fr.length;
      const lefty = FS.settings.fretboard.lefty;
      const fretted = fr.filter((x) => x > 0);
      const maxF = fretted.length ? Math.max(...fretted) : 0;
      const minF = fretted.length ? Math.min(...fretted) : 1;
      const start = maxF <= 5 ? 1 : minF;
      const rows = 5;
      const sw = n > 6 ? 18 : 22;
      const fh = 26;
      const left = 30;
      const topY = 30;
      const W = left + sw * (n - 1) + 24;
      const H = topY + fh * rows + 14;
      const colX = (s) => left + sw * (lefty ? n - 1 - s : s);
      const p = [`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chord diagram">`];
      if (start === 1) p.push(`<rect x="${left - 1}" y="${topY - 4}" width="${sw * (n - 1) + 2}" height="5" rx="1" class="cb-nut"/>`);
      else p.push(`<text class="cb-fr" x="${left - 10}" y="${topY + fh / 2 + 4}" text-anchor="end">${start}fr</text>`);
      for (let r = 0; r <= rows; r++) p.push(`<line class="cb-line" x1="${left}" x2="${left + sw * (n - 1)}" y1="${topY + r * fh}" y2="${topY + r * fh}"/>`);
      for (let s = 0; s < n; s++) p.push(`<line class="cb-line" x1="${colX(s)}" x2="${colX(s)}" y1="${topY}" y2="${topY + rows * fh}"/>`);
      fr.forEach((f, s) => {
        const x = colX(s);
        if (f < 0) p.push(`<text class="cb-mark" x="${x}" y="${topY - 10}">×</text>`);
        else if (f === 0) p.push(`<circle class="cb-open" cx="${x}" cy="${topY - 14}" r="4.5"/>`);
        else {
          const row = f - start;
          if (row < 0 || row >= rows) return;
          const pc = t.mod12(tuning[s] + f);
          const root = !unknown && pc === st.root;
          const fill = root ? 'var(--dot-root)' : 'var(--dot-note)';
          p.push(`<circle class="cb-dot${root ? ' root' : ''}" cx="${x}" cy="${topY + row * fh + fh / 2}" r="${sw * 0.38}" style="--dot:${fill}"/>`);
        }
      });
      p.push('</svg>');
      box.innerHTML = `<div class="cb-diagram">${p.join('')}</div>${chordTab(fr)}`;
    }

    // The same chord as tablature: one column, highest string on top, x = muted; plus the usual
    // shorthand (low string first, e.g. x32010) underneath.
    function chordTab(fr) {
      const tun = FS.currentTuning();
      const n = fr.length;
      const names = (tun.flats ? t.FLAT : t.SHARP).map(t.pretty);
      const gap = n > 6 ? 17 : 19;
      const left = 28;
      const W = left + 72;
      const top = 14;
      const H = top + (n - 1) * gap + 14;
      const cx = left + 34;
      const q = [`<svg class="tab" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chord tablature: ${fr.map((f, s) => `string ${n - s} ${f < 0 ? 'muted' : `fret ${f}`}`).join(', ')}">`];
      for (let line = 0; line < n; line++) {
        const s = n - 1 - line;
        const y = top + line * gap;
        q.push(`<text class="tab-str" x="${left - 10}" y="${y}">${names[t.mod12(tun.notes[s])]}</text>`);
        q.push(`<line class="tab-line" x1="${left - 4}" x2="${W - 2}" y1="${y}" y2="${y}"/>`);
        const f = fr[s];
        const txt = f < 0 ? 'x' : String(f);
        const w = txt.length * 9 + 8;
        const cls = f < 0 ? ' muted' : !unknown && t.mod12(tun.notes[s] + f) === st.root ? ' root' : '';
        q.push(`<g class="tab-note${cls}"><rect x="${cx - w / 2}" y="${y - 9}" width="${w}" height="18" rx="4"/><text x="${cx}" y="${y}">${txt}</text></g>`);
      }
      q.push(`<line class="tab-bar" x1="${left - 4}" x2="${left - 4}" y1="${top}" y2="${top + (n - 1) * gap}"/>`);
      q.push(`<line class="tab-bar" x1="${W - 2}" x2="${W - 2}" y1="${top}" y2="${top + (n - 1) * gap}"/>`);
      q.push('</svg>');
      const short = fr.map((f) => (f < 0 ? 'x' : String(f))).join(fr.some((f) => f > 9) ? '-' : '');
      return `<div class="cb-tab">${q.join('')}<div class="cb-short" title="Low string first">${short}</div></div>`;
    }

    /* ---- Playback ---- */

    function strum() {
      const fr = currentFrets();
      if (!fr) return;
      const ctx = FS.audio.ctx();
      const tuning = FS.currentTuning().notes;
      const bump = tuning.length <= 5 ? 12 : 0;
      let i = 0;
      FS.audio.prepare(fr.map((f, s) => tuning[s] + f + bump).filter((m, s) => fr[s] >= 0));
      const t0 = ctx.currentTime + 0.04;
      fr.forEach((f, s) => {
        if (f < 0) return;
        const midi = tuning[s] + f;
        const when = t0 + i++ * 0.04;
        FS.audio.playNote(midi + bump, when, 1.8, 0.38);
        setTimeout(() => board.flash(midi, 400), (when - ctx.currentTime) * 1000);
      });
    }

    let tuningKey = FS.currentTuning().notes.join('.');
    FS.on('fretboard', () => {
      const k = FS.currentTuning().notes.join('.');
      if (k !== tuningKey) {
        // A custom shape means something else in a new tuning.
        tuningKey = k;
        st.custom = null;
        unknown = false;
      }
      render();
    });
    render();
  };
})();
