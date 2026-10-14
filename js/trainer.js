/* Fretbored — Trainer tab: fretboard note games (name the note / find the note). */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  const PRESETS = [
    ['Open – 12', 0, 12],
    ['Open – 4', 0, 4],
    ['5 – 9', 5, 9],
    ['7 – 12', 7, 12],
    ['12 – 17', 12, 17],
    ['All frets', 0, 24],
  ];
  const NATURALS = new Set([0, 2, 4, 5, 7, 9, 11]);
  const CHALLENGE_MS = 60000;
  const FIND_MAX_MISTAKES = 3;
  const WEAK_MIN = 5; // answers needed before a note can be flagged weak
  const WEAK_BELOW = 0.7;
  const GOOD = 'var(--good)';
  const BAD = 'var(--danger)';

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  FS.initTrainer = function (panel) {
    const t = FS.theory;
    const st = FS.settings.trainer;
    if (!st.stats || typeof st.stats !== 'object') st.stats = {};
    for (const k of ['notes', 'pos', 'days']) if (!st.stats[k] || typeof st.stats[k] !== 'object') st.stats[k] = {};
    if (!st.bestTimed || typeof st.bestTimed !== 'object') st.bestTimed = { name: 0, find: 0 };

    const game = {
      q: null, // name mode: { s, f, pc, midi }; find mode: { pc, cells: [...] }
      prev: null,
      answered: null, // name: picked pc; find: 'ok' | 'bad'
      found: new Set(),
      mistakes: 0,
      wrongMarks: [],
      asked: 0,
      correct: 0,
      streak: 0,
      best: 0,
      timer: null,
      timed: null, // { end, score, asked, done, raf, newBest }
    };

    /* ---------------------------------------------------------------- Helpers */

    const tuning = () => FS.currentTuning().notes;
    const maxFret = () => FS.settings.fretboard.frets;
    const pcName = (pc) => (t.SHARP[pc] === t.FLAT[pc] ? t.SHARP[pc] : `${t.pretty(t.SHARP[pc])}/${t.pretty(t.FLAT[pc])}`);
    const shortName = (pc) => t.pretty(t.SHARP[pc]);
    const stringsOn = () => {
      const n = tuning().length;
      if (!Array.isArray(st.strings) || st.strings.length !== n) st.strings = new Array(n).fill(true);
      return st.strings;
    };
    const isActive = (s, f) => f >= st.from && f <= st.to && !!stringsOn()[s];
    const allowedPc = (pc) => !st.naturals || NATURALS.has(pc);
    const posKey = (s, f) => `${tuning()[s]}:${f}`; // stable across tunings that share a string
    function activeCells() {
      const out = [];
      tuning().forEach((open, s) => {
        for (let f = st.from; f <= st.to; f++) {
          if (!isActive(s, f)) continue;
          const pc = t.mod12(open + f);
          if (allowedPc(pc)) out.push({ s, f, pc, midi: open + f });
        }
      });
      return out;
    }
    // Smoothed miss rate: unseen = 0.5, so new notes get asked too.
    const missRate = (rec) => (rec ? (rec[0] - rec[1] + 1) / (rec[0] + 2) : 0.5);
    function pickWeighted(items, weight) {
      if (!items.length) return null;
      const ws = items.map(weight);
      let r = Math.random() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < items.length; i++) if ((r -= ws[i]) <= 0) return items[i];
      return items[items.length - 1];
    }
    const timedRunning = () => game.timed && !game.timed.done;
    const bassBump = () => (tuning().length <= 5 ? 12 : 0); // bass is muddy on phone speakers

    /* ---------------------------------------------------------------- DOM */

    const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Game' });
    for (const [v, label] of [['name', 'Name the note'], ['find', 'Find the note']]) {
      modeSeg.append(
        h('button', {
          dataset: { v },
          onclick: () => {
            if (st.mode === v) return;
            st.mode = v;
            FS.save();
            stopTimed(true);
            game.prev = null;
            renderSetup();
            newQuestion();
          },
        }, label)
      );
    }

    const fromSel = h('select', { 'aria-label': 'From fret' });
    const toSel = h('select', { 'aria-label': 'To fret' });
    fromSel.addEventListener('change', () => setRange(+fromSel.value, Math.max(+fromSel.value, st.to)));
    toSel.addEventListener('change', () => setRange(Math.min(st.from, +toSel.value), +toSel.value));
    const presets = h('div', { class: 'pills', role: 'group', 'aria-label': 'Fret range presets' });
    for (const [label, a, b] of PRESETS) {
      presets.append(h('button', { class: 'pill', dataset: { a, b }, onclick: () => setRange(a, Math.min(b, maxFret())) }, label));
    }
    const stringChips = h('div', { class: 'pills', role: 'group', 'aria-label': 'Strings to quiz' });

    const toggle = (label, key, onChange) => {
      const input = h('input', { type: 'checkbox', role: 'switch' });
      input.addEventListener('change', () => {
        st[key] = input.checked;
        FS.save();
        if (onChange) onChange();
      });
      const el = h('label', { class: 'field switch-field compact' }, h('span', { class: 'switch' }, input, h('span', { class: 'slider' })), h('span', { class: 'tr-opt' }, label));
      el.input = input;
      el.key = key;
      return el;
    };
    const options = [
      toggle('Natural notes only', 'naturals', () => { renderSetup(); game.prev = null; newQuestion(); }),
      toggle('Dim outside range', 'dim', () => renderBoard()),
      toggle('Focus on weak spots', 'adaptive'),
      toggle('Play sound', 'sound', () => { renderPrompt(); if (st.sound) playQuestion(); }),
    ];

    const stat = (label) => {
      const v = h('div', { class: 'tr-stat-val' }, '0');
      return { el: h('div', { class: 'tr-stat' }, v, h('div', { class: 'tr-stat-label' }, label)), v };
    };
    const sAsked = stat('Questions');
    const sCorrect = stat('Correct');
    const sPct = stat('Accuracy');
    const sStreak = stat('Streak');
    const challengeBtn = h('button', { class: 'btn primary small', onclick: () => (timedRunning() ? stopTimed(false) : startTimed()) });
    const resetBtn = h('button', { class: 'btn ghost small', onclick: () => resetScore() }, 'Reset score');
    const timedClock = h('div', { class: 'tr-clock' });
    const timedBar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
    const timedInfo = h('div', { class: 'tr-timed-info' });
    const timedBox = h('div', { class: 'tr-timed' }, timedClock, h('div', { class: 'tr-timed-main' }, timedBar, timedInfo));

    const prompt = h('div', { class: 'tr-prompt-text' });
    const replayBtn = h('button', { class: 'btn ghost small', onclick: () => playQuestion(), title: 'Play the note again' }, '🔊 Replay');
    const showBtn = h('button', { class: 'btn ghost small', onclick: () => giveUp() }, 'Show answer');
    const promptRow = h('div', { class: 'tr-prompt' }, prompt, h('div', { class: 'tr-prompt-actions' }, replayBtn, showBtn));
    const answers = h('div', { class: 'tr-answers', role: 'group', 'aria-label': 'Answer' });
    for (let pc = 0; pc < 12; pc++) {
      const sharp = t.SHARP[pc];
      const flat = t.FLAT[pc];
      const label = sharp === flat ? h('span', { class: 'tr-nat' }, sharp) : [h('span', null, t.pretty(sharp)), h('span', null, t.pretty(flat))];
      answers.append(h('button', { class: 'tr-answer' + (sharp === flat ? '' : ' acc'), dataset: { pc }, onclick: () => answer(pc) }, label));
    }
    const answersTitle = h('h3', { class: 'section-title' }, 'Which note is it?');

    const history = h('div', { class: 'tr-history', role: 'img' });
    const noteGrid = h('div', { class: 'tr-acc-grid' });
    const stringGrid = h('div', { class: 'tr-acc-grid' });
    const resetStatsBtn = h('button', { class: 'btn ghost small', onclick: () => resetStats() }, 'Reset progress');

    const fbControls = h('div');
    const fbHost = h('div');

    panel.append(
      h('div', { class: 'card controls' },
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Game'), modeSeg),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Frets'),
          h('div', { class: 'stack' },
            presets,
            h('div', { class: 'inline wrap' }, h('span', { class: 'muted small' }, 'From'), fromSel, h('span', { class: 'muted small' }, 'to'), toSel))),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Quiz strings'), stringChips),
        h('div', { class: 'control-row' }, h('span', { class: 'row-label' }, 'Options'), h('div', { class: 'tr-options' }, ...options))
      ),
      h('div', { class: 'card tr-score' },
        h('div', { class: 'tr-score-row' },
          h('div', { class: 'tr-stats' }, sAsked.el, sCorrect.el, sPct.el, sStreak.el),
          h('div', { class: 'tr-score-actions' }, challengeBtn, resetBtn)),
        timedBox
      ),
      h('div', { class: 'card board-card' },
        fbControls,
        promptRow,
        fbHost,
        answersTitle,
        answers
      ),
      h('div', { class: 'card tr-progress' },
        h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, 'Last 7 days'), resetStatsBtn),
        history,
        h('h3', { class: 'section-title' }, 'Accuracy by note'),
        noteGrid,
        h('h3', { class: 'section-title' }, 'Accuracy by string'),
        stringGrid,
        h('p', { class: 'muted small' }, 'Progress is saved on this device. “Focus on weak spots” asks the notes and positions you miss more often.')
      )
    );

    // The fretboard is always the first section on a tab (owner's layout rule).
    panel.prepend(panel.querySelector('.board-card'));
    FS.createFretboardControls(fbControls);
    const board = new FS.Fretboard(fbHost, { onToggle: tapCell, onRoot: tapCell });

    /* ---------------------------------------------------------------- Questions */

    function setRange(a, b) {
      st.from = a;
      st.to = b;
      clampRange();
      FS.save();
      renderSetup();
      game.prev = null;
      newQuestion();
    }

    function clampRange() {
      st.to = Math.min(st.to, maxFret());
      st.from = Math.min(st.from, st.to);
    }

    function newQuestion() {
      clearTimeout(game.timer);
      clampRange();
      game.answered = null;
      game.found = new Set();
      game.mistakes = 0;
      game.wrongMarks = [];
      if (game.timed && game.timed.done) {
        game.q = null;
        render();
        return;
      }
      const cells = activeCells();
      if (st.mode === 'find') {
        const pcs = [...new Set(cells.map((c) => c.pc))];
        const fresh = pcs.length > 1 && game.prev ? pcs.filter((pc) => pc !== game.prev.pc) : pcs;
        const pc = pickWeighted(fresh, (p) => (st.adaptive ? 1 + 4 * missRate(st.stats.notes[p]) : 1));
        game.q = pc === null ? null : { pc, cells: cells.filter((c) => c.pc === pc) };
      } else {
        const fresh = cells.filter((c) => !(game.prev && game.prev.s === c.s && game.prev.f === c.f));
        const pool = fresh.length ? fresh : cells;
        game.q = pickWeighted(pool, (c) => (st.adaptive ? 1 + 4 * missRate(st.stats.pos[posKey(c.s, c.f)]) + 3 * missRate(st.stats.notes[c.pc]) : 1));
      }
      render();
      if (game.q && st.mode === 'name') board.scrollToFret(game.q.f);
      else board.scrollToFret(Math.round((st.from + st.to) / 2));
      if (st.sound) playQuestion();
    }

    function playQuestion() {
      if (!game.q) return;
      const midi = st.mode === 'name' ? game.q.midi : Math.min(...game.q.cells.map((c) => c.midi));
      FS.audio.playNote(midi + bassBump(), FS.audio.ctx().currentTime + 0.03, 1.2, 0.5);
    }

    function answer(pc) {
      if (st.mode !== 'name' || !game.q || game.answered !== null) return;
      const ok = pc === game.q.pc;
      game.answered = pc;
      record(game.q.pc, posKey(game.q.s, game.q.f), ok);
      finish(ok);
    }

    // Find mode: tapping a fretboard cell.
    function tapCell(s, f) {
      if (st.mode !== 'find' || !game.q || game.answered !== null || !isActive(s, f)) return;
      const pc = t.mod12(tuning()[s] + f);
      const key = `${s}:${f}`;
      if (pc === game.q.pc) {
        if (game.found.has(key)) return;
        game.found.add(key);
        if (st.sound) FS.audio.playNote(tuning()[s] + f + bassBump(), FS.audio.ctx().currentTime + 0.02, 0.8, 0.45);
        if (game.found.size >= game.q.cells.length) {
          const ok = game.mistakes === 0;
          game.answered = ok ? 'ok' : 'bad';
          record(game.q.pc, null, ok);
          finish(ok);
          return;
        }
      } else {
        game.mistakes++;
        const mark = { s, f, pc };
        game.wrongMarks.push(mark);
        setTimeout(() => {
          game.wrongMarks = game.wrongMarks.filter((m) => m !== mark);
          renderBoard();
        }, 800);
        if (game.mistakes >= FIND_MAX_MISTAKES) return giveUp();
      }
      render();
    }

    function giveUp() {
      if (!game.q || game.answered !== null) return;
      if (st.mode === 'name') return answer(-1);
      game.answered = 'bad';
      record(game.q.pc, null, false);
      finish(false);
    }

    function finish(ok) {
      game.asked++;
      if (ok) {
        game.correct++;
        game.streak++;
        game.best = Math.max(game.best, game.streak);
      } else game.streak = 0;
      const fast = timedRunning();
      if (fast) {
        game.timed.asked++;
        if (ok) game.timed.score++;
      }
      game.prev = st.mode === 'name' ? game.q : { pc: game.q.pc };
      render();
      renderTimed();
      game.timer = setTimeout(newQuestion, ok ? (fast ? 300 : 700) : fast ? 1000 : 1700);
    }

    function record(pc, pos, ok) {
      const S = st.stats;
      const bump = (obj, k) => {
        const r = obj[k] || [0, 0];
        r[0]++;
        if (ok) r[1]++;
        obj[k] = r;
      };
      bump(S.notes, pc);
      if (pos) bump(S.pos, pos);
      bump(S.days, dayKey(new Date()));
      // Keep 90 days of history.
      const cutoff = dayKey(new Date(Date.now() - 90 * 864e5));
      for (const k of Object.keys(S.days)) if (k < cutoff) delete S.days[k];
      FS.save();
      renderProgress();
    }

    function resetScore() {
      stopTimed(true);
      game.asked = game.correct = game.streak = game.best = 0;
      game.prev = null;
      newQuestion();
    }

    function resetStats() {
      if (!window.confirm('Reset all saved Trainer progress (history, accuracy and best challenge scores)?')) return;
      st.stats = { notes: {}, pos: {}, days: {} };
      st.bestTimed = { name: 0, find: 0 };
      FS.save();
      renderProgress();
      renderTimed();
    }

    /* ---------------------------------------------------------------- 60-second challenge */

    function startTimed() {
      stopTimed(true);
      game.timed = { end: performance.now() + CHALLENGE_MS, score: 0, asked: 0, done: false, raf: 0, newBest: false };
      game.prev = null;
      const tick = () => {
        if (!game.timed || game.timed.done) return;
        if (performance.now() >= game.timed.end) return endTimed();
        renderTimed();
        game.timed.raf = requestAnimationFrame(tick);
      };
      game.timed.raf = requestAnimationFrame(tick);
      renderTimed();
      newQuestion();
    }

    function endTimed() {
      const T = game.timed;
      T.done = true;
      cancelAnimationFrame(T.raf);
      clearTimeout(game.timer);
      if (T.score > (st.bestTimed[st.mode] || 0)) {
        st.bestTimed[st.mode] = T.score;
        T.newBest = true;
        FS.save();
      }
      game.q = null;
      renderTimed();
      render();
    }

    // quiet: drop the challenge without a result (mode change, reset, leaving the tab)
    function stopTimed(quiet) {
      if (!game.timed) return;
      if (!quiet) return endTimed();
      cancelAnimationFrame(game.timed.raf);
      game.timed = null;
      renderTimed();
    }

    /* ---------------------------------------------------------------- Rendering */

    function renderSetup() {
      modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.mode));
      const m = maxFret();
      clampRange();
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
      const notes = tuning();
      const on = stringsOn();
      stringChips.innerHTML = '';
      notes.forEach((open, s) => {
        stringChips.append(
          h('button', {
            class: 'pill tr-string' + (on[s] ? ' active' : ''),
            title: `String ${notes.length - s}`,
            'aria-pressed': String(on[s]),
            onclick: () => {
              if (on[s] && on.filter(Boolean).length === 1) return FS.toast('Keep at least one string');
              on[s] = !on[s];
              FS.save();
              renderSetup();
              game.prev = null;
              newQuestion();
            },
          }, h('span', { class: 'tr-string-num' }, String(notes.length - s)), shortName(t.mod12(open)))
        );
      });
      options.forEach((o) => (o.input.checked = !!st[o.key]));
      answers.hidden = st.mode !== 'name';
      answers.classList.toggle('naturals', !!st.naturals);
      answersTitle.hidden = st.mode !== 'name';
      renderTimed();
    }

    function renderBoard() {
      const q = game.q;
      const notes = [];
      if (q && st.mode === 'name') {
        const done = game.answered !== null;
        const ok = done && game.answered === q.pc;
        notes.push({ s: q.s, f: q.f, kind: 'root', label: done ? shortName(q.pc) : '?', color: done ? (ok ? GOOD : BAD) : undefined });
      } else if (q) {
        const reveal = game.answered === 'bad';
        for (const c of q.cells) {
          if (game.found.has(`${c.s}:${c.f}`)) notes.push({ s: c.s, f: c.f, kind: 'note', label: shortName(c.pc), color: GOOD });
          else if (reveal) notes.push({ s: c.s, f: c.f, kind: 'note', label: shortName(c.pc) });
        }
        for (const w of game.wrongMarks) notes.push({ s: w.s, f: w.f, kind: 'note', label: shortName(w.pc), color: BAD });
      }
      board.setModel({ notes, muted: [], isActive: st.dim ? isActive : null });
    }

    function renderPrompt() {
      const q = game.q;
      const n = tuning().length;
      let text = '';
      let cls = '';
      if (game.timed && game.timed.done) {
        const T = game.timed;
        text = `⏱ Time! ${T.score} correct out of ${T.asked}${T.newBest ? ' — new best!' : ` (best ${st.bestTimed[st.mode]})`}`;
        cls = 'right';
      } else if (!q) text = 'No notes in the practice area — widen the range or add strings';
      else if (st.mode === 'name') {
        const done = game.answered !== null;
        const ok = done && game.answered === q.pc;
        if (!done) text = `String ${n - q.s}, ${q.f === 0 ? 'open' : `fret ${q.f}`}`;
        else if (ok) (text = `✓ Correct — ${pcName(q.pc)}`), (cls = 'right');
        else (text = `✗ It’s ${pcName(q.pc)}`), (cls = 'wrong');
      } else {
        const total = q.cells.length;
        if (game.answered === 'ok') (text = `✓ Found all ${total} × ${pcName(q.pc)}`), (cls = 'right');
        else if (game.answered === 'bad') (text = `✗ Here are all the ${pcName(q.pc)}`), (cls = 'wrong');
        else text = `Tap every ${pcName(q.pc)} — ${game.found.size} of ${total} found${game.mistakes ? ` · ${game.mistakes} miss${game.mistakes > 1 ? 'es' : ''}` : ''}`;
      }
      prompt.textContent = text;
      promptRow.className = 'tr-prompt' + (cls ? ` ${cls}` : '');
      replayBtn.hidden = !st.sound || !q;
      showBtn.hidden = st.mode !== 'find' || !q || game.answered !== null;
    }

    function renderScore() {
      sAsked.v.textContent = game.asked;
      sCorrect.v.textContent = game.correct;
      sPct.v.textContent = game.asked ? `${Math.round((100 * game.correct) / game.asked)}%` : '–';
      sStreak.v.textContent = game.best ? `${game.streak} (best ${game.best})` : String(game.streak);
    }

    function renderTimed() {
      const T = game.timed;
      challengeBtn.textContent = timedRunning() ? '■ Stop challenge' : T && T.done ? '⏱ Play again' : '⏱ 60-second challenge';
      timedBox.hidden = !T;
      if (!T) return;
      const left = T.done ? 0 : Math.max(0, T.end - performance.now());
      const secs = Math.ceil(left / 1000);
      const clock = `0:${String(secs).padStart(2, '0')}`;
      if (timedClock.textContent !== clock) timedClock.textContent = clock;
      timedClock.classList.toggle('low', !T.done && secs <= 10);
      timedBar.firstChild.style.width = `${(left / CHALLENGE_MS) * 100}%`;
      const info = `${T.score} correct · best ${st.bestTimed[st.mode] || 0}`;
      if (timedInfo.textContent !== info) timedInfo.textContent = info;
    }

    function render() {
      renderBoard();
      renderPrompt();
      renderScore();
      const done = game.answered !== null || !game.q;
      answers.querySelectorAll('.tr-answer').forEach((b) => {
        const pc = +b.dataset.pc;
        const q = game.q;
        b.hidden = !!st.naturals && !NATURALS.has(pc);
        b.classList.toggle('right', !!q && game.answered !== null && pc === q.pc);
        b.classList.toggle('wrong', !!q && game.answered === pc && pc !== q.pc);
        b.disabled = done;
      });
    }

    function renderProgress() {
      const S = st.stats;
      // Last 7 days: bar height = questions answered; accuracy written underneath.
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5);
        const rec = S.days[dayKey(d)] || [0, 0];
        days.push({ d, asked: rec[0], correct: rec[1] });
      }
      const max = Math.max(1, ...days.map((x) => x.asked));
      history.innerHTML = '';
      history.setAttribute('aria-label', 'Questions answered per day for the last 7 days: ' + days.map((x) => `${x.d.toLocaleDateString(undefined, { weekday: 'short' })} ${x.asked}`).join(', '));
      for (const x of days) {
        const pct = x.asked ? Math.round((100 * x.correct) / x.asked) : null;
        history.append(
          h('div', {
            class: 'tr-day',
            title: `${x.d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${x.asked} question${x.asked === 1 ? '' : 's'}${pct !== null ? `, ${pct}% correct` : ''}`,
          },
            h('div', { class: 'tr-day-count' }, x.asked ? String(x.asked) : ''),
            h('div', { class: 'tr-day-track' }, h('div', { class: 'tr-day-bar', style: `height:${(x.asked / max) * 100}%` })),
            h('div', { class: 'tr-day-label' }, x.d.toLocaleDateString(undefined, { weekday: 'short' })),
            h('div', { class: 'tr-day-pct' }, pct !== null ? `${pct}%` : '–')
          )
        );
      }

      const accCell = (name, rec, extra) => {
        const asked = rec ? rec[0] : 0;
        const acc = asked ? rec[1] / asked : null;
        const weak = asked >= WEAK_MIN && acc < WEAK_BELOW;
        return h('div', { class: 'tr-acc' + (weak ? ' weak' : ''), title: asked ? `${name}: ${rec[1]} of ${asked} correct` : `${name}: not asked yet` },
          h('div', { class: 'tr-acc-head' }, h('span', { class: 'tr-acc-name' }, name), extra || null, weak ? h('span', { class: 'tr-weak' }, '⚠ weak') : null),
          h('div', { class: 'tr-acc-track' }, h('div', { class: 'tr-acc-bar', style: `width:${acc === null ? 0 : acc * 100}%` })),
          h('div', { class: 'tr-acc-val' }, acc === null ? 'not asked yet' : `${Math.round(acc * 100)}% of ${asked}`)
        );
      };
      noteGrid.innerHTML = '';
      for (let pc = 0; pc < 12; pc++) noteGrid.append(accCell(pcName(pc), S.notes[pc]));

      // Per string of the current tuning, from the position stats.
      stringGrid.innerHTML = '';
      const notes = tuning();
      for (let s = notes.length - 1; s >= 0; s--) {
        let a = 0;
        let c = 0;
        for (const [k, r] of Object.entries(S.pos)) {
          if (+k.split(':')[0] === notes[s]) {
            a += r[0];
            c += r[1];
          }
        }
        stringGrid.append(accCell(`String ${notes.length - s}`, a ? [a, c] : null, h('span', { class: 'muted small' }, shortName(t.mod12(notes[s])))));
      }
    }

    /* ---------------------------------------------------------------- Lifecycle */

    // Keyboard (name mode): letters answer naturals, Shift+letter the sharp.
    document.addEventListener('keydown', (e) => {
      if (FS.settings.tab !== 'trainer' || st.mode !== 'name' || e.metaKey || e.ctrlKey || e.altKey) return;
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
      renderSetup();
      renderProgress();
      if (k !== tuningKey) {
        // Positions mean different notes now: ask a fresh question.
        tuningKey = k;
        game.prev = null;
        newQuestion();
      } else renderBoard();
    });
    FS.on('tab', (tab) => {
      if (tab !== 'trainer' && timedRunning()) stopTimed(true);
    });

    renderSetup();
    renderProgress();
    newQuestion();
  };
})();
