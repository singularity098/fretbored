/* Fretbored — Trainer tab: name the highlighted note on the fretboard. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  const PRESETS = [
    ['Open – 4', 0, 4],
    ['5 – 9', 5, 9],
    ['7 – 12', 7, 12],
    ['12 – 17', 12, 17],
    ['All frets', 0, 24],
  ];
  const NEXT_AFTER_RIGHT = 700; // ms
  const NEXT_AFTER_WRONG = 1600;

  FS.initTrainer = function (panel) {
    const t = FS.theory;
    const st = FS.settings.trainer;

    const game = { q: null, prev: null, asked: 0, correct: 0, streak: 0, best: 0, answered: null, timer: null };

    /* ---------------------------------------------------------------- DOM */

    const fromSel = h('select', { 'aria-label': 'From fret' });
    const toSel = h('select', { 'aria-label': 'To fret' });
    fromSel.addEventListener('change', () => setRange(+fromSel.value, Math.max(+fromSel.value, st.to)));
    toSel.addEventListener('change', () => setRange(Math.min(st.from, +toSel.value), +toSel.value));
    const presets = h('div', { class: 'pills', role: 'group', 'aria-label': 'Fret range presets' });
    for (const [label, a, b] of PRESETS) {
      presets.append(h('button', { class: 'pill', dataset: { a, b }, onclick: () => setRange(a, Math.min(b, maxFret())) }, label));
    }

    const stat = (label) => {
      const v = h('div', { class: 'tr-stat-val' }, '0');
      return { el: h('div', { class: 'tr-stat' }, v, h('div', { class: 'tr-stat-label' }, label)), v };
    };
    const sAsked = stat('Questions');
    const sCorrect = stat('Correct');
    const sPct = stat('Accuracy');
    const sStreak = stat('Streak');
    const resetBtn = h('button', { class: 'btn ghost small', onclick: () => resetScore() }, 'Reset score');

    const prompt = h('div', { class: 'tr-prompt' });
    const answers = h('div', { class: 'tr-answers', role: 'group', 'aria-label': 'Answer' });
    for (let pc = 0; pc < 12; pc++) {
      const sharp = t.SHARP[pc];
      const flat = t.FLAT[pc];
      const label = sharp === flat ? h('span', { class: 'tr-nat' }, sharp) : [h('span', null, t.pretty(sharp)), h('span', null, t.pretty(flat))];
      answers.append(h('button', { class: 'tr-answer' + (sharp === flat ? '' : ' acc'), dataset: { pc }, onclick: () => answer(pc) }, label));
    }

    const fbControls = h('div');
    const fbHost = h('div');

    panel.append(
      h('div', { class: 'card controls' },
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Frets'),
          h('div', { class: 'stack' },
            presets,
            h('div', { class: 'inline wrap' }, h('span', { class: 'muted small' }, 'From'), fromSel, h('span', { class: 'muted small' }, 'to'), toSel)))
      ),
      h('div', { class: 'card tr-score' },
        h('div', { class: 'tr-stats' }, sAsked.el, sCorrect.el, sPct.el, sStreak.el),
        resetBtn
      ),
      h('div', { class: 'card board-card' },
        // Collapsed so the game fits on a phone screen; same shared settings as the other tabs.
        h('details', { class: 'tr-settings' }, h('summary', null, 'Fretboard settings', h('span', { class: 'muted small tr-tuning' })), fbControls),
        prompt,
        fbHost,
        h('h3', { class: 'section-title' }, 'Which note is it?'),
        answers
      )
    );

    FS.createFretboardControls(fbControls);
    // Taps on the fretboard do nothing here; answers come from the buttons.
    const board = new FS.Fretboard(fbHost, { onToggle() {}, onRoot() {} });

    /* ---------------------------------------------------------------- Game */

    const maxFret = () => FS.settings.fretboard.frets;
    const tuning = () => FS.currentTuning().notes;

    function clampRange() {
      const m = maxFret();
      st.to = Math.min(st.to, m);
      st.from = Math.min(st.from, st.to);
    }

    function setRange(a, b) {
      st.from = a;
      st.to = b;
      clampRange();
      FS.save();
      renderRange();
      newQuestion();
    }

    function newQuestion() {
      clearTimeout(game.timer);
      clampRange();
      const notes = tuning();
      const all = [];
      notes.forEach((open, s) => {
        for (let f = st.from; f <= st.to; f++) all.push({ s, f, pc: t.mod12(open + f) });
      });
      // Don't ask the exact same spot twice in a row (unless it's the only one).
      const fresh = all.filter((c) => !(game.prev && game.prev.s === c.s && game.prev.f === c.f));
      const cells = fresh.length ? fresh : all;
      game.q = cells[Math.floor(Math.random() * cells.length)] || null;
      game.answered = null;
      render();
      if (game.q) board.scrollToFret(game.q.f);
    }

    function answer(pc) {
      if (!game.q || game.answered !== null) return;
      const right = pc === game.q.pc;
      game.answered = pc;
      game.asked++;
      if (right) {
        game.correct++;
        game.streak++;
        game.best = Math.max(game.best, game.streak);
      } else game.streak = 0;
      render();
      game.prev = game.q;
      game.timer = setTimeout(newQuestion, right ? NEXT_AFTER_RIGHT : NEXT_AFTER_WRONG);
    }

    function resetScore() {
      game.asked = game.correct = game.streak = game.best = 0;
      newQuestion();
    }

    /* ---------------------------------------------------------------- Rendering */

    function renderRange() {
      const m = maxFret();
      panel.querySelector('.tr-tuning').textContent = `${FS.currentTuning().name} · ${FS.tuningLabel(FS.currentTuning())}`;
      for (const [sel, val] of [[fromSel, st.from], [toSel, st.to]]) {
        sel.innerHTML = '';
        for (let f = 0; f <= m; f++) sel.append(h('option', { value: f }, f === 0 ? 'Open' : String(f)));
        sel.value = val;
      }
      presets.querySelectorAll('.pill').forEach((b) => {
        const a = +b.dataset.a;
        const bb = Math.min(+b.dataset.b, m);
        b.classList.toggle('active', st.from === a && st.to === bb);
        b.hidden = a > m;
      });
    }

    function render() {
      const q = game.q;
      const done = game.answered !== null;
      const right = done && game.answered === q.pc;
      const name = q ? (t.SHARP[q.pc] === t.FLAT[q.pc] ? t.SHARP[q.pc] : `${t.pretty(t.SHARP[q.pc])}/${t.pretty(t.FLAT[q.pc])}`) : '';

      board.setModel({
        notes: q ? [{ s: q.s, f: q.f, kind: 'root', label: done ? name.split('/')[0] : '?' }] : [],
        muted: [],
      });

      const n = tuning().length;
      prompt.className = 'tr-prompt' + (done ? (right ? ' right' : ' wrong') : '');
      if (!q) prompt.textContent = 'No frets in range';
      else if (!done) prompt.textContent = `String ${n - q.s}, ${q.f === 0 ? 'open' : `fret ${q.f}`}`;
      else prompt.textContent = right ? `✓ Correct — ${name}` : `✗ It’s ${name}`;

      answers.querySelectorAll('.tr-answer').forEach((b) => {
        const pc = +b.dataset.pc;
        b.classList.toggle('right', done && pc === q.pc);
        b.classList.toggle('wrong', done && pc === game.answered && !right);
        b.disabled = done;
      });

      sAsked.v.textContent = game.asked;
      sCorrect.v.textContent = game.correct;
      sPct.v.textContent = game.asked ? `${Math.round((100 * game.correct) / game.asked)}%` : '–';
      sStreak.v.textContent = game.best ? `${game.streak} (best ${game.best})` : String(game.streak);
    }

    // Keyboard: letter keys answer naturals; Shift+letter = sharp of that letter.
    document.addEventListener('keydown', (e) => {
      if (FS.settings.tab !== 'trainer' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;
      const i = 'CDEFGAB'.indexOf(e.key.toUpperCase());
      if (i < 0) return;
      e.preventDefault();
      answer(t.mod12([0, 2, 4, 5, 7, 9, 11][i] + (e.shiftKey ? 1 : 0)));
    });

    let tuningKey = tuning().join('.') + '|' + maxFret();
    FS.on('fretboard', () => {
      const k = tuning().join('.') + '|' + maxFret();
      renderRange();
      if (k !== tuningKey) {
        // Positions mean different notes now: ask a fresh question.
        tuningKey = k;
        newQuestion();
      }
    });

    renderRange();
    newQuestion();
  };
})();
