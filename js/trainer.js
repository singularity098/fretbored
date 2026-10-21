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
  // Answer speed: a right answer scores 50 points plus up to 50 more for speed — the full bonus at
  // FAST_MS or quicker, none from SLOW_MS (find mode times each note found, not the whole round).
  const FAST_MS = 1500;
  const SLOW_MS = 6000;
  const MAX_MS = 10000; // longer times are saved as this, so one wander-off doesn't skew averages
  const SLOW_RATIO = 1.4; // a note this much slower than your average (and over SLOW_FLOOR) is flagged slow
  const SLOW_FLOOR = 1500;
  const GOOD = 'var(--good)';
  const BAD = 'var(--danger)';

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // The local day before a 'YYYY-MM-DD' key.
  const prevDay = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d - 1));
  };
  const DAILY_GOAL = 50; // answered notes in a day that keep the daily streak going

  FS.initTrainer = function (panel) {
    const t = FS.theory;
    const st = FS.settings.trainer;
    if (!st.stats || typeof st.stats !== 'object') st.stats = {};
    for (const k of ['notes', 'pos', 'days']) if (!st.stats[k] || typeof st.stats[k] !== 'object') st.stats[k] = {};
    if (!st.bestTimed || typeof st.bestTimed !== 'object') st.bestTimed = { name: 0, find: 0 };
    initStreak();

    /*
     * Daily streak: stats.streak = { count, last, best } — count of consecutive days that reached
     * DAILY_GOAL, ending on `last` (a day key). Kept separately so it can outlive the 90-day
     * history; rebuilt from that history the first time (progress saved before streaks existed).
     */
    function initStreak() {
      const S = st.stats;
      if (S.streak && typeof S.streak === 'object' && typeof S.streak.count === 'number') return;
      let run = 0;
      let last = null;
      let best = 0;
      for (const k of Object.keys(S.days).sort()) {
        if (S.days[k][0] < DAILY_GOAL) continue;
        run = last && prevDay(k) === last ? run + 1 : 1;
        last = k;
        best = Math.max(best, run);
      }
      S.streak = { count: run, last, best };
    }
    // Still alive until the end of today, even if today's goal isn't reached yet.
    function currentStreak() {
      const s = st.stats.streak;
      const today = dayKey(new Date());
      return s.last === today || s.last === prevDay(today) ? s.count : 0;
    }

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
      timed: null, // { end, score, asked, done, raf, newBest, ms, timedN }
      shownAt: 0, // performance.now() when the question appeared
      untimed: false, // the page was hidden or settings changed mid-question: don't time it
      lastMs: null, // the answer time just recorded (per note in find mode)
      lastPts: 0,
      points: 0,
      ms: 0, // summed answer times of this session's timed right answers
      timedN: 0,
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
    // Records are [asked, correct, msSum, timedN]; the times are of right answers only.
    const avgMs = (rec) => (rec && rec[3] ? rec[2] / rec[3] : null);
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    // 0 = as quick as your overall average (or not enough timed answers yet), 1 = twice as slow.
    const slowRate = (rec, overall) => (rec && rec[3] >= 3 && overall ? clamp01(avgMs(rec) / overall - 1) : 0);
    const overallMs = (recs) => {
      let ms = 0;
      let n = 0;
      for (const r of recs) if (r && r[3]) (ms += r[2]), (n += r[3]);
      return n ? ms / n : null;
    };
    const fmtSecs = (ms) => `${(ms / 1000).toFixed(1)} s`;
    const speedPoints = (ms) => 50 + (ms === null ? 0 : Math.round(50 * clamp01((SLOW_MS - ms) / (SLOW_MS - FAST_MS))));
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
    const sPoints = stat('Points');
    const sAsked = stat('Questions');
    const sCorrect = stat('Correct');
    const sPct = stat('Accuracy');
    const sTime = stat('Avg time');
    const sStreak = stat('In a row');
    const sDaily = stat('Day streak');
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
    const streakNum = h('div', { class: 'tr-streak-num' });
    const streakBest = h('div', { class: 'tr-streak-best muted small' });
    const goalBar = h('div', { class: 'tr-goal-bar' });
    const goalText = h('div', { class: 'tr-goal-text small' });
    const streakBox = h('div', { class: 'tr-streak' },
      h('div', { class: 'tr-streak-main' }, streakNum, streakBest),
      h('div', { class: 'tr-goal' }, h('div', { class: 'tr-goal-track', role: 'progressbar', 'aria-label': `Today's goal: ${DAILY_GOAL} notes`, 'aria-valuemin': 0, 'aria-valuemax': DAILY_GOAL }, goalBar), goalText));
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
          h('div', { class: 'tr-stats' }, sPoints.el, sAsked.el, sCorrect.el, sPct.el, sTime.el, sStreak.el, sDaily.el),
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
        h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, 'Daily streak'), resetStatsBtn),
        streakBox,
        h('h3', { class: 'section-title' }, 'Last 7 days'),
        history,
        h('h3', { class: 'section-title' }, 'Accuracy and speed by note'),
        noteGrid,
        h('h3', { class: 'section-title' }, 'Accuracy and speed by string'),
        stringGrid,
        h('p', { class: 'muted small' }, 'Progress is saved on this device. Right answers score 50 points plus up to 50 for speed; times are the average of right answers (per note found in “Find the note”). “Focus on weak spots” asks the notes and positions you miss or answer slowly more often.')
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
        const avg = overallMs(Object.values(st.stats.notes));
        const pc = pickWeighted(fresh, (p) => (st.adaptive ? 1 + 4 * missRate(st.stats.notes[p]) + 3 * slowRate(st.stats.notes[p], avg) : 1));
        game.q = pc === null ? null : { pc, cells: cells.filter((c) => c.pc === pc) };
      } else {
        const fresh = cells.filter((c) => !(game.prev && game.prev.s === c.s && game.prev.f === c.f));
        const pool = fresh.length ? fresh : cells;
        const avg = overallMs(Object.values(st.stats.notes));
        const posAvg = overallMs(Object.values(st.stats.pos));
        game.q = pickWeighted(pool, (c) => {
          if (!st.adaptive) return 1;
          const pos = st.stats.pos[posKey(c.s, c.f)];
          const note = st.stats.notes[c.pc];
          return 1 + 4 * missRate(pos) + 3 * missRate(note) + 2 * slowRate(pos, posAvg) + 3 * slowRate(note, avg);
        });
      }
      game.shownAt = performance.now();
      game.untimed = false;
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
      const ms = ok ? answerMs(1) : null;
      record(game.q.pc, posKey(game.q.s, game.q.f), ok, ms);
      finish(ok, ms);
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
          const ms = ok ? answerMs(game.q.cells.length) : null;
          record(game.q.pc, null, ok, ms);
          finish(ok, ms);
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

    // Time since the question appeared, per note (find mode finds `notes` of them); null if untimed.
    function answerMs(notes) {
      if (game.untimed) return null;
      return Math.min(MAX_MS, Math.round((performance.now() - game.shownAt) / notes));
    }

    // ms: answer time of a right answer (null when wrong or untimed)
    function finish(ok, ms = null) {
      game.asked++;
      game.lastMs = ms;
      game.lastPts = ok ? speedPoints(ms) : 0;
      game.points += game.lastPts;
      if (ms !== null) (game.ms += ms), game.timedN++;
      if (ok) {
        game.correct++;
        game.streak++;
        game.best = Math.max(game.best, game.streak);
      } else game.streak = 0;
      const fast = timedRunning();
      if (fast) {
        game.timed.asked++;
        if (ok) game.timed.score++;
        if (ms !== null) (game.timed.ms += ms), game.timed.timedN++;
      }
      game.prev = st.mode === 'name' ? game.q : { pc: game.q.pc };
      render();
      renderTimed();
      game.timer = setTimeout(newQuestion, ok ? (fast ? 300 : 700) : fast ? 1000 : 1700);
    }

    function record(pc, pos, ok, ms = null) {
      const S = st.stats;
      const bump = (obj, k) => {
        const r = obj[k] || [0, 0];
        r[0]++;
        if (ok) r[1]++;
        if (ms !== null) (r[2] = (r[2] || 0) + ms), (r[3] = (r[3] || 0) + 1);
        obj[k] = r;
      };
      bump(S.notes, pc);
      if (pos) bump(S.pos, pos);
      const today = dayKey(new Date());
      bump(S.days, today);
      if (S.days[today][0] === DAILY_GOAL) {
        // Today's goal just reached: extend the streak (or start a new one).
        const sk = S.streak;
        sk.count = sk.last === prevDay(today) ? sk.count + 1 : sk.last === today ? sk.count : 1;
        sk.last = today;
        sk.best = Math.max(sk.best, sk.count);
        FS.toast(`🔥 ${DAILY_GOAL} notes today — ${sk.count}-day streak!`);
      }
      // Keep 90 days of history.
      const cutoff = dayKey(new Date(Date.now() - 90 * 864e5));
      for (const k of Object.keys(S.days)) if (k < cutoff) delete S.days[k];
      FS.save();
      renderProgress();
    }

    function resetScore() {
      stopTimed(true);
      game.asked = game.correct = game.streak = game.best = game.points = game.ms = game.timedN = 0;
      game.prev = null;
      newQuestion();
    }

    function resetStats() {
      if (!window.confirm('Reset all saved Trainer progress (history, daily streak, accuracy and best challenge scores)?')) return;
      st.stats = { notes: {}, pos: {}, days: {} };
      initStreak();
      st.bestTimed = { name: 0, find: 0 };
      FS.save();
      renderProgress();
      renderTimed();
    }

    /* ---------------------------------------------------------------- 60-second challenge */

    function startTimed() {
      stopTimed(true);
      game.timed = { end: performance.now() + CHALLENGE_MS, score: 0, asked: 0, done: false, raf: 0, newBest: false, ms: 0, timedN: 0 };
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
        text = `⏱ Time! ${T.score} correct out of ${T.asked}${T.newBest ? ' — new best!' : ` (best ${st.bestTimed[st.mode]})`}${T.timedN ? ` · ${fmtSecs(T.ms / T.timedN)} avg` : ''}`;
        cls = 'right';
      } else if (!q) text = 'No notes in the practice area — widen the range or add strings';
      else if (st.mode === 'name') {
        const done = game.answered !== null;
        const ok = done && game.answered === q.pc;
        if (!done) text = `String ${n - q.s}, ${q.f === 0 ? 'open' : `fret ${q.f}`}`;
        else if (ok) (text = `✓ Correct — ${pcName(q.pc)}${speedText()}`), (cls = 'right');
        else (text = `✗ It’s ${pcName(q.pc)}`), (cls = 'wrong');
      } else {
        const total = q.cells.length;
        if (game.answered === 'ok') (text = `✓ Found all ${total} × ${pcName(q.pc)}${speedText(total > 1 ? ' per note' : '')}`), (cls = 'right');
        else if (game.answered === 'bad') (text = `✗ Here are all the ${pcName(q.pc)}`), (cls = 'wrong');
        else text = `Tap every ${pcName(q.pc)} — ${game.found.size} of ${total} found${game.mistakes ? ` · ${game.mistakes} miss${game.mistakes > 1 ? 'es' : ''}` : ''}`;
      }
      prompt.textContent = text;
      promptRow.className = 'tr-prompt' + (cls ? ` ${cls}` : '');
      replayBtn.hidden = !st.sound || !q;
      showBtn.hidden = st.mode !== 'find' || !q || game.answered !== null;
    }

    // " · 1.4 s · +89" after a right answer
    function speedText(per = '') {
      return `${game.lastMs !== null ? ` · ${fmtSecs(game.lastMs)}${per}` : ''} · +${game.lastPts}`;
    }

    function renderScore() {
      sPoints.v.textContent = game.points;
      sTime.v.textContent = game.timedN ? fmtSecs(game.ms / game.timedN) : '–';
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
      const info = `${T.score} correct${T.timedN ? ` · ${fmtSecs(T.ms / T.timedN)} avg` : ''} · best ${st.bestTimed[st.mode] || 0}`;
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
      // Daily streak and today's progress towards the goal.
      const streak = currentStreak();
      const todayN = (S.days[dayKey(new Date())] || [0])[0];
      streakNum.textContent = streak ? `🔥 ${streak}-day streak` : 'No streak yet';
      streakBest.textContent = S.streak.best ? `Best: ${S.streak.best} day${S.streak.best === 1 ? '' : 's'}` : `Answer ${DAILY_GOAL} notes in a day to start one`;
      goalBar.style.width = `${Math.min(1, todayN / DAILY_GOAL) * 100}%`;
      goalBar.parentElement.setAttribute('aria-valuenow', String(Math.min(todayN, DAILY_GOAL)));
      streakBox.classList.toggle('done', todayN >= DAILY_GOAL);
      goalText.textContent = todayN >= DAILY_GOAL ? `✓ Today: ${todayN} notes — goal reached` : `Today: ${todayN} / ${DAILY_GOAL} notes${streak && S.streak.last !== dayKey(new Date()) ? ' — keep the streak going' : ''}`;
      sDaily.v.textContent = streak ? `🔥 ${streak}` : '0';
      // Last 7 days: bar height = questions answered; accuracy written underneath.
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5);
        const rec = S.days[dayKey(d)] || [0, 0];
        days.push({ d, asked: rec[0], correct: rec[1], ms: avgMs(rec) });
      }
      const max = Math.max(1, ...days.map((x) => x.asked));
      history.innerHTML = '';
      history.setAttribute('aria-label', 'Questions answered per day for the last 7 days: ' + days.map((x) => `${x.d.toLocaleDateString(undefined, { weekday: 'short' })} ${x.asked}`).join(', '));
      for (const x of days) {
        const pct = x.asked ? Math.round((100 * x.correct) / x.asked) : null;
        history.append(
          h('div', {
            class: 'tr-day' + (x.asked >= DAILY_GOAL ? ' goal' : ''),
            title: `${x.d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${x.asked} question${x.asked === 1 ? '' : 's'}${pct !== null ? `, ${pct}% correct` : ''}${x.ms !== null ? `, ${fmtSecs(x.ms)} average` : ''}${x.asked >= DAILY_GOAL ? ' — daily goal reached' : ''}`,
          },
            h('div', { class: 'tr-day-count' }, x.asked ? String(x.asked) : ''),
            h('div', { class: 'tr-day-track' }, h('div', { class: 'tr-day-bar', style: `height:${(x.asked / max) * 100}%` })),
            h('div', { class: 'tr-day-label' }, x.d.toLocaleDateString(undefined, { weekday: 'short' })),
            h('div', { class: 'tr-day-pct' }, pct !== null ? `${pct}%` : '–')
          )
        );
      }

      // overall: average answer time the cells are compared with to flag slow ones
      const accCell = (name, rec, overall, extra) => {
        const asked = rec ? rec[0] : 0;
        const acc = asked ? rec[1] / asked : null;
        const ms = avgMs(rec);
        const weak = asked >= WEAK_MIN && acc < WEAK_BELOW;
        const slow = !weak && rec && rec[3] >= WEAK_MIN && overall && ms >= SLOW_RATIO * overall && ms >= SLOW_FLOOR;
        const flag = weak ? '⚠ weak' : slow ? '🐢 slow' : null;
        return h('div', { class: 'tr-acc' + (flag ? ' weak' : ''), title: asked ? `${name}: ${rec[1]} of ${asked} correct${ms !== null ? `, ${fmtSecs(ms)} on average (yours overall: ${fmtSecs(overall)})` : ''}` : `${name}: not asked yet` },
          h('div', { class: 'tr-acc-head' }, h('span', { class: 'tr-acc-name' }, name), extra || null, flag ? h('span', { class: 'tr-weak' }, flag) : null),
          h('div', { class: 'tr-acc-track' }, h('div', { class: 'tr-acc-bar', style: `width:${acc === null ? 0 : acc * 100}%` })),
          h('div', { class: 'tr-acc-val' }, acc === null ? 'not asked yet' : `${Math.round(acc * 100)}% of ${asked}${ms !== null ? ` · ${fmtSecs(ms)}` : ''}`)
        );
      };
      noteGrid.innerHTML = '';
      const notesAvg = overallMs(Object.values(S.notes));
      for (let pc = 0; pc < 12; pc++) noteGrid.append(accCell(pcName(pc), S.notes[pc], notesAvg));

      // Per string of the current tuning, from the position stats.
      stringGrid.innerHTML = '';
      const notes = tuning();
      const posAvg = overallMs(Object.values(S.pos));
      for (let s = notes.length - 1; s >= 0; s--) {
        const sum = [0, 0, 0, 0];
        for (const [k, r] of Object.entries(S.pos)) {
          if (+k.split(':')[0] === notes[s]) for (let i = 0; i < 4; i++) sum[i] += r[i] || 0;
        }
        stringGrid.append(accCell(`String ${notes.length - s}`, sum[0] ? sum : null, posAvg, h('span', { class: 'muted small' }, shortName(t.mod12(notes[s])))));
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
      if (tab !== 'trainer') game.untimed = true;
      if (tab !== 'trainer' && timedRunning()) stopTimed(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) game.untimed = true;
    });

    renderSetup();
    renderProgress();
    newQuestion();
  };
})();
