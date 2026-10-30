/* Fretbored — Guitar Scales tab. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);
  const T = () => FS.theory;

  FS.initScales = function (panel) {
    const t = T();
    const st = FS.settings.scales;
    if (!t.SCALE_BY_ID[st.scaleId] && st.scaleId !== null) st.scaleId = 'major';
    if (typeof st.pcs !== 'number') st.pcs = t.rotate(t.SCALE_BY_ID[st.scaleId || 'major'].mask, st.root);
    const initial = t.matchScale(st.pcs, st.root).exact;
    st.scaleId = initial ? initial.id : null;

    /* ---- DOM ---- */
    const rootPills = h('div', { class: 'pills root-pills', role: 'group', 'aria-label': 'Key' });
    for (let pc = 0; pc < 12; pc++) {
      rootPills.append(h('button', { class: 'pill', dataset: { pc }, onclick: () => setRoot(pc, true) }, t.pretty(t.pcLabel(pc))));
    }
    const catSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Scale category' });
    for (const [id, label] of t.SCALE_CATEGORIES) {
      catSeg.append(h('button', { dataset: { v: id }, onclick: () => setCategory(id) }, label));
    }
    const scaleSel = h('select', { class: 'scale-select', 'aria-label': 'Scale' });
    scaleSel.addEventListener('change', () => {
      if (scaleSel.value) selectScale(scaleSel.value);
    });

    const title = h('h2', { class: 'hero-title' });
    const sub = h('div', { class: 'hero-sub' });
    const chips = h('div', { class: 'note-chips' });
    const match = h('div', { class: 'match' });
    const resetBtn = h('button', { class: 'btn ghost', title: 'Undo manual edits', onclick: () => reset() }, 'Reset');

    const fbControls = h('div');
    const fbHost = h('div');

    // What a plain tap does. "Set root" is a gesture-free alternative to long-press.
    let tapMode = 'toggle';
    const tapSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tap action' });
    for (const [v, label] of [['toggle', 'Add / remove'], ['root', 'Set root']]) {
      tapSeg.append(h('button', { dataset: { v }, onclick: () => { tapMode = v; renderTapSeg(); } }, label));
    }
    const renderTapSeg = () => tapSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === tapMode));
    renderTapSeg();

    panel.append(
      h('div', { class: 'card controls' },
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Key'), rootPills),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Scale'), h('div', { class: 'inline wrap' }, catSeg, scaleSel))
      ),
      h('div', { class: 'card hero' },
        h('div', { class: 'hero-head' },
          h('div', null, title, sub),
          h('div', { class: 'hero-actions' }, resetBtn)
        ),
        chips,
        match
      ),
      h('div', { class: 'card board-card' },
        fbControls,
        fbHost,
        h('div', { class: 'tap-row' },
          h('span', { class: 'field-label' }, 'Tap to'),
          tapSeg,
          h('span', { class: 'hint' }, 'Add / remove changes that note everywhere · Right-click or long-press a note to make it the root'))
      )
    );

    // The fretboard is always the first section on a tab (owner's layout rule).
    panel.prepend(panel.querySelector('.board-card'));
    FS.createFretboardControls(fbControls);
    const board = new FS.Fretboard(fbHost, {
      onToggle: (s, f) => (tapMode === 'root' ? makeRoot(pcAt(s, f)) : toggle(pcAt(s, f))),
      onRoot: (s, f) => makeRoot(pcAt(s, f)),
    });

    const pcAt = (s, f) => t.mod12(FS.currentTuning().notes[s] + f);
    const nowBar = FS.createNowBar(panel, panel.querySelector('.hero'), () => play());

    /* ---- State changes ---- */

    function commit(fromEdit) {
      const m = t.matchScale(st.pcs, st.root);
      const prev = st.scaleId;
      st.scaleId = m.exact ? m.exact.id : null;
      if (m.exact) st.category = m.exact.category;
      FS.save();
      render(m);
      if (fromEdit && m.exact && m.exact.id !== prev) {
        FS.toast(`Matched ${t.pretty(spelled().root)} ${m.exact.name}`);
      }
    }

    function setRoot(pc) {
      st.pcs = t.rotate(st.pcs, pc - st.root);
      st.root = pc;
      commit(false);
    }

    function selectScale(id, root) {
      const s = t.SCALE_BY_ID[id];
      if (root !== undefined) st.root = root;
      st.pcs = t.rotate(s.mask, st.root);
      st.category = s.category;
      commit(false);
    }

    function setCategory(cat) {
      st.category = cat;
      const cur = t.SCALE_BY_ID[st.scaleId];
      if (!cur || cur.category !== cat) selectScale(t.SCALES.find((s) => s.category === cat).id);
      else render();
    }

    function toggle(pc) {
      if (pc === st.root) {
        FS.toast('That’s the root — long-press or right-click another note to move the root first');
        return;
      }
      st.pcs ^= t.bit(pc);
      commit(true);
    }

    function makeRoot(pc) {
      st.root = pc;
      st.pcs |= t.bit(pc);
      commit(true);
    }

    function reset() {
      const id = st.scaleId || st.lastScale || 'major';
      selectScale(id);
    }

    /* ---- Rendering ---- */

    function relIntervals() {
      return t.pcsOf(t.rotate(st.pcs, -st.root));
    }

    function spelled() {
      const s = t.SCALE_BY_ID[st.scaleId];
      if (s) return { ...t.spell(st.root, s.intervals, s.labels), intervals: s.intervals, labels: s.labels };
      const ivs = relIntervals();
      const labels = t.defaultLabels(ivs);
      return { ...t.spell(st.root, ivs, labels), intervals: ivs, labels };
    }

    function render(m) {
      m = m || t.matchScale(st.pcs, st.root);
      const sp = spelled();
      const scale = t.SCALE_BY_ID[st.scaleId];
      if (scale) st.lastScale = scale.id;

      rootPills.querySelectorAll('.pill').forEach((b) => {
        const active = +b.dataset.pc === st.root;
        b.classList.toggle('active', active);
        b.textContent = active ? t.pretty(sp.root) : t.pretty(t.pcLabel(+b.dataset.pc));
      });
      catSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.category));
      scaleSel.innerHTML = '';
      if (!scale) scaleSel.append(h('option', { value: '' }, 'Custom scale'));
      for (const s of t.SCALES.filter((x) => x.category === st.category)) scaleSel.append(h('option', { value: s.id }, s.name));
      scaleSel.value = scale ? scale.id : '';

      title.innerHTML = '';
      title.append(h('span', { class: 'accent-text' }, t.pretty(sp.root)), ' ', scale ? scale.name : 'Custom scale');
      sub.textContent = `${sp.intervals.length} notes · ${sp.labels.map(t.pretty).join(' ')}`;
      resetBtn.hidden = !!scale;

      chips.innerHTML = '';
      sp.names.forEach((nm, i) => {
        chips.append(
          h('div', { class: 'chip' + (i === 0 ? ' root' : '') }, h('span', { class: 'chip-note' }, t.pretty(nm)), h('span', { class: 'chip-iv' }, t.pretty(sp.labels[i])))
        );
      });

      match.innerHTML = '';
      if (scale && m.sameNotes.length) {
        match.append(h('span', { class: 'match-label' }, 'Same notes as'));
        for (const x of m.sameNotes.slice(0, 6)) {
          const rn = t.spell(x.root, x.scale.intervals, x.scale.labels).root;
          match.append(h('button', { class: 'chip-btn', onclick: () => selectScale(x.scale.id, x.root) }, `${t.pretty(rn)} ${x.scale.name}`));
        }
      } else if (!scale) {
        if (m.sameNotes.length) {
          match.append(h('span', { class: 'match-label' }, 'These notes form'));
          for (const x of m.sameNotes.slice(0, 4)) {
            const rn = t.spell(x.root, x.scale.intervals, x.scale.labels).root;
            match.append(h('button', { class: 'chip-btn', onclick: () => selectScale(x.scale.id, x.root) }, `${t.pretty(rn)} ${x.scale.name}`));
          }
        }
        if (m.near.length) {
          match.append(h('span', { class: 'match-label' }, 'Closest scales'));
          for (const x of m.near) {
            const diff = [
              ...x.added.map((pc) => '+' + t.pretty(t.pcLabel(pc).split('/')[0])),
              ...x.removed.map((pc) => '−' + t.pretty(t.pcLabel(pc).split('/')[0])),
            ].join(' ');
            match.append(
              h('button', { class: 'chip-btn', onclick: () => selectScale(x.scale.id) }, `${x.scale.name} `, h('span', { class: 'diff' }, diff))
            );
          }
        }
        if (!m.sameNotes.length && !m.near.length) match.append(h('span', { class: 'match-label' }, 'No close match in the library'));
      }

      nowBar.set({
        accent: t.pretty(sp.root),
        rest: scale ? scale.name : 'Custom scale',
        notes: sp.names.map(t.pretty).join('  ·  '),
        action: playing ? '■ Stop' : '▶ Play',
      });
      renderBoard(sp);
    }

    function renderBoard(sp) {
      sp = sp || spelled();
      const nameOf = {};
      const ivOf = {};
      sp.intervals.forEach((iv, i) => {
        const pc = t.mod12(st.root + iv);
        nameOf[pc] = sp.names[i];
        ivOf[pc] = sp.labels[i];
      });
      const tuning = FS.currentTuning().notes;
      const frets = FS.settings.fretboard.frets;
      const useIv = FS.settings.fretboard.labels === 'intervals';
      const notes = [];
      tuning.forEach((open, s) => {
        for (let f = 0; f <= frets; f++) {
          const pc = t.mod12(open + f);
          if (!(st.pcs & t.bit(pc))) continue;
          notes.push({ s, f, kind: pc === st.root ? 'root' : 'note', label: useIv ? ivOf[pc] : nameOf[pc], iv: t.mod12(pc - st.root) });
        }
      });
      board.setModel({ notes, muted: [] });
    }

    /* ---- Playback ---- */

    let playing = null;
    function play() {
      if (playing) {
        stopPlaying();
        return;
      }
      const ctx = FS.audio.ctx();
      const tuning = FS.currentTuning().notes;
      let base = tuning[0];
      while (t.mod12(base) !== st.root) base++;
      const bump = tuning.length <= 5 ? 12 : 0; // bass notes are muddy on a laptop speaker
      const seq = relIntervals().map((iv) => base + iv).concat(base + 12);
      const step = 0.3;
      FS.audio.prepare(seq.map((m) => m + bump));
      const t0 = ctx.currentTime + 0.05;
      const timers = [];
      seq.forEach((midi, i) => {
        const when = t0 + i * step;
        FS.audio.playNote(midi + bump, when, i === seq.length - 1 ? 1.2 : step * 1.6, 0.55);
        timers.push(setTimeout(() => board.flash(midi, step * 1000), (when - ctx.currentTime) * 1000));
      });
      timers.push(setTimeout(stopPlaying, (seq.length * step + 0.6) * 1000));
      playing = { timers };
      render();
    }
    function stopPlaying() {
      if (!playing) return;
      playing.timers.forEach(clearTimeout);
      playing = null;
      render();
    }

    FS.on('fretboard', () => renderBoard());
    FS.on('scales:set', ({ root, scaleId }) => selectScale(scaleId, root));
    render();
  };
})();
