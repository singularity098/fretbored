/* Fretbored — Metronome tab.
 *
 * Timing: every click is scheduled on the Web Audio clock (sample-accurate) a little
 * ahead of time by a lookahead loop, so JavaScript timer jitter never reaches the audio.
 * The loop is driven from a Web Worker so it keeps running smoothly in background tabs.
 */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  const MIN_BPM = 20;
  const MAX_BPM = 300;
  const LOOKAHEAD = 0.15; // seconds of audio scheduled ahead
  const TICK_MS = 25;

  const SUBDIVISIONS = [
    ['none', 'Quarter', [0]],
    ['8', 'Eighths', [0, 1 / 2]],
    ['trip', 'Triplets', [0, 1 / 3, 2 / 3]],
    ['16', 'Sixteenths', [0, 1 / 4, 2 / 4, 3 / 4]],
    ['5', 'Quintuplets', [0, 1 / 5, 2 / 5, 3 / 5, 4 / 5]],
    ['6', 'Sextuplets', [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]],
    ['swing', 'Swing', [0, 2 / 3]],
    ['dotted', 'Dotted 8th + 16th', [0, 3 / 4]],
    ['8-16-16', '8th + two 16ths', [0, 1 / 2, 3 / 4]],
    ['16-16-8', 'Two 16ths + 8th', [0, 1 / 4, 1 / 2]],
    ['16-8-16', '16th + 8th + 16th', [0, 1 / 4, 3 / 4]],
  ];
  const SUB_BY_ID = Object.fromEntries(SUBDIVISIONS.map((s) => [s[0], s[2]]));

  const SOUND_SETS = {
    classic: { name: 'Classic', accent: 'high', beat: 'low', sub: 'low' },
    digital: { name: 'Digital', accent: 'digitalHigh', beat: 'digitalLow', sub: 'digitalLow' },
    beep: { name: 'Beep', accent: 'beepHigh', beat: 'beepMid', sub: 'beepLow' },
  };
  const LEVEL_GAIN = [0, 0.4, 0.8, 1.0];
  const LEVEL_NAMES = ['Muted', 'Soft', 'Normal', 'Accent'];

  const clampBpm = (v) => Math.min(MAX_BPM, Math.max(MIN_BPM, v));

  function tempoMarking(bpm) {
    const marks = [[40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto']];
    for (const [lim, name] of marks) if (bpm < lim) return name;
    return 'Prestissimo';
  }

  function defaultGrouping(beats, noteValue) {
    if (noteValue < 8 || beats < 5) return '';
    if (beats % 3 === 0) return Array(beats / 3).fill(3).join('+');
    if (beats === 5) return '3+2';
    if (beats === 7) return '2+2+3';
    const groups = [];
    let left = beats;
    while (left > 4) {
      groups.push(3);
      left -= 3;
    }
    if (left === 4) groups.push(2, 2);
    else if (left) groups.push(left);
    return groups.join('+');
  }

  function levelsFromGrouping(beats, grouping) {
    const levels = Array(beats).fill(2);
    levels[0] = 3;
    const groups = parseGrouping(grouping);
    if (!groups || groups.reduce((a, b) => a + b, 0) !== beats) return levels;
    let i = 0;
    groups.forEach((g, gi) => {
      for (let k = 0; k < g; k++) levels[i + k] = k === 0 ? (gi === 0 ? 3 : 2) : 1;
      i += g;
    });
    return levels;
  }

  function parseGrouping(str) {
    if (!str || !/^\s*\d+(\s*\+\s*\d+)*\s*$/.test(str)) return null;
    return str.split('+').map((x) => parseInt(x, 10)).filter((x) => x > 0);
  }

  FS.initMetronome = function (panel) {
    const m = FS.settings.metronome;
    m.bpm = clampBpm(m.bpm);
    if (!SUB_BY_ID[m.subdivision]) m.subdivision = 'none';
    if (!SOUND_SETS[m.sound]) m.sound = 'classic';
    const fixLevels = () => {
      while (m.levels.length < m.beats) m.levels.push(2);
      m.levels.length = m.beats;
    };
    fixLevels();

    /* ================================================================ Engine */

    const eng = {
      running: false,
      nextTime: 0,
      beat: 0,
      bar: 0,
      count: 0,
      liveBpm: m.bpm,
      barsSinceStep: 0,
      startTime: 0,
      sources: [],
      queue: [],
      current: null,
      wake: null,
    };

    let worker = null;
    let fallbackTimer = null;
    try {
      const src = 'let id=null;onmessage=e=>{if(e.data==="start"){clearInterval(id);id=setInterval(()=>postMessage(0),' + TICK_MS + ')}else{clearInterval(id);id=null}}';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = () => schedule();
    } catch (e) {
      worker = null; // e.g. blocked on file:// in some browsers — fall back to setInterval
    }
    const startTicker = () => (worker ? worker.postMessage('start') : (fallbackTimer = setInterval(schedule, TICK_MS)));
    const stopTicker = () => (worker ? worker.postMessage('stop') : clearInterval(fallbackTimer));

    const trainerOn = () => m.trainer.mode !== 'off';

    async function start() {
      if (eng.running) return;
      const ctx = FS.audio.ctx();
      await FS.audio.loadSamples();
      if (ctx.state !== 'running') await ctx.resume();
      fixLevels();
      eng.running = true;
      eng.beat = 0;
      eng.bar = 0;
      eng.count = 0;
      eng.barsSinceStep = 0;
      eng.liveBpm = trainerOn() ? clampBpm(m.trainer.start) : m.bpm;
      eng.nextTime = ctx.currentTime + 0.1;
      eng.startTime = eng.nextTime;
      eng.queue = [];
      eng.current = null;
      schedule();
      startTicker();
      requestAnimationFrame(draw);
      try {
        if (navigator.wakeLock) eng.wake = await navigator.wakeLock.request('screen');
      } catch (e) {
        eng.wake = null;
      }
      renderRunning();
    }

    function stop() {
      if (!eng.running) return;
      eng.running = false;
      stopTicker();
      // Cancel clicks that haven't sounded yet; let one already playing finish (cutting it pops).
      const now = FS.audio.ctx().currentTime;
      for (const s of eng.sources) {
        if (s.time <= now) continue;
        try {
          s.src.stop();
        } catch (e) {
          /* already finished */
        }
      }
      eng.sources = [];
      eng.queue = [];
      eng.current = null;
      if (eng.wake) eng.wake.release().catch(() => {});
      eng.wake = null;
      renderRunning();
      resetVisuals();
    }

    function schedule() {
      if (!eng.running) return;
      const ctx = FS.audio.ctx();
      while (eng.nextTime < ctx.currentTime + LOOKAHEAD) {
        scheduleBeat(eng.nextTime, 60 / eng.liveBpm);
        advance();
      }
      const cutoff = ctx.currentTime - 1;
      if (eng.sources.length > 64) eng.sources = eng.sources.filter((s) => s.time > cutoff);
    }

    function scheduleBeat(time, dur) {
      const set = SOUND_SETS[m.sound];
      const vol = m.volume;
      const cycle = Math.max(1, m.gap.play) + Math.max(0, m.gap.mute);
      const silent = m.gap.on && m.gap.mute > 0 && eng.bar % cycle >= Math.max(1, m.gap.play);
      const lvl = m.levels[eng.beat] === undefined ? 2 : m.levels[eng.beat];
      if (!silent) {
        if (lvl > 0) {
          const src = FS.audio.playSample(lvl === 3 ? set.accent : set.beat, time, LEVEL_GAIN[lvl] * vol);
          if (src) eng.sources.push({ src, time });
        }
        const offs = SUB_BY_ID[m.subdivision];
        for (let i = 1; i < offs.length; i++) {
          const t = time + offs[i] * dur;
          const src = FS.audio.playSample(set.sub, t, m.subVolume * vol * 0.75);
          if (src) eng.sources.push({ src, time: t });
        }
      }
      eng.queue.push({ time, dur, beat: eng.beat, bar: eng.bar, n: eng.count, silent, lvl, bpm: eng.liveBpm });
    }

    function advance() {
      eng.nextTime += 60 / eng.liveBpm;
      eng.count++;
      eng.beat++;
      if (eng.beat >= m.beats) {
        eng.beat = 0;
        eng.bar++;
        if (m.trainer.mode === 'step') {
          eng.barsSinceStep++;
          if (eng.barsSinceStep >= Math.max(1, m.trainer.every)) {
            eng.barsSinceStep = 0;
            const { end, step } = m.trainer;
            const dir = Math.sign(end - eng.liveBpm);
            eng.liveBpm = dir > 0 ? Math.min(end, eng.liveBpm + Math.abs(step)) : dir < 0 ? Math.max(end, eng.liveBpm - Math.abs(step)) : eng.liveBpm;
          }
        }
      }
      if (m.trainer.mode === 'ramp') {
        const total = Math.max(1, m.trainer.rampBars) * m.beats;
        const p = Math.min(1, eng.count / total);
        eng.liveBpm = m.trainer.start + (m.trainer.end - m.trainer.start) * p;
      } else if (!trainerOn()) {
        eng.liveBpm = m.bpm;
      }
      eng.liveBpm = clampBpm(eng.liveBpm);
    }

    // Context time at which audio is currently reaching the speakers.
    function audibleNow(ctx) {
      if (ctx.getOutputTimestamp) {
        const ts = ctx.getOutputTimestamp();
        if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
          return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        }
      }
      return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    }

    /* ================================================================ UI */

    const bpmNum = h('div', { class: 'bpm-num', 'aria-live': 'off' });
    const bpmMark = h('div', { class: 'bpm-mark' });
    const bpmInput = h('input', { type: 'number', min: MIN_BPM, max: MAX_BPM, inputmode: 'numeric', class: 'bpm-input', 'aria-label': 'Tempo in BPM' });
    const slider = h('input', { type: 'range', min: MIN_BPM, max: MAX_BPM, step: 1, class: 'bpm-slider', 'aria-label': 'Tempo' });
    const startBtn = h('button', { class: 'btn primary start-btn', onclick: () => (eng.running ? stop() : start()) });
    const tapBtn = h('button', { class: 'btn tap-btn', onclick: () => tap() }, 'Tap');
    const dots = h('div', { class: 'beat-dots', role: 'group', 'aria-label': 'Beats — tap to change accent' });
    const sweep = h('div', { class: 'sweep' }, h('div', { class: 'sweep-ball' }));
    const status = h('div', { class: 'met-status' });

    const stepBtn = (label, delta) => {
      const b = h('button', { class: 'btn round', 'aria-label': `${delta > 0 ? 'Increase' : 'Decrease'} tempo by ${Math.abs(delta)}` }, label);
      let timer = null;
      let rep = null;
      const fire = () => setBpm(m.bpm + delta);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fire();
        timer = setTimeout(() => (rep = setInterval(fire, 70)), 400);
      });
      const end = () => {
        clearTimeout(timer);
        clearInterval(rep);
      };
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, end));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fire();
        }
      });
      return b;
    };

    // Meter
    const beatsVal = h('span', { class: 'stepper-val' });
    const beatsStepper = h('div', { class: 'stepper' },
      h('button', { class: 'btn round small', 'aria-label': 'Fewer beats', onclick: () => setBeats(m.beats - 1) }, '−'),
      beatsVal,
      h('button', { class: 'btn round small', 'aria-label': 'More beats', onclick: () => setBeats(m.beats + 1) }, '+')
    );
    const noteSel = h('select', { 'aria-label': 'Beat note value' });
    [2, 4, 8, 16].forEach((v) => noteSel.append(h('option', { value: v }, String(v))));
    noteSel.addEventListener('change', () => {
      m.noteValue = +noteSel.value;
      applyDefaultAccents();
    });
    const groupInput = h('input', { type: 'text', placeholder: 'e.g. 2+2+3', 'aria-label': 'Beat grouping', class: 'group-input' });
    groupInput.addEventListener('change', () => {
      const g = parseGrouping(groupInput.value);
      if (!g || g.reduce((a, b) => a + b, 0) !== m.beats) {
        FS.toast(`Grouping must add up to ${m.beats}`);
        groupInput.value = m.grouping;
        return;
      }
      m.grouping = g.join('+');
      m.levels = levelsFromGrouping(m.beats, m.grouping);
      FS.save();
      renderAll();
    });
    const groupField = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Grouping'), groupInput);
    const subPills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Subdivision' });
    for (const [id, label] of SUBDIVISIONS) {
      subPills.append(h('button', { class: 'pill', dataset: { v: id }, onclick: () => { m.subdivision = id; FS.save(); renderAll(); } }, label));
    }

    // Sound
    const soundSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Click sound' });
    for (const [id, s] of Object.entries(SOUND_SETS)) {
      soundSeg.append(h('button', { dataset: { v: id }, onclick: () => { m.sound = id; FS.save(); renderAll(); preview(); } }, s.name));
    }
    const volSlider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': 'Volume' });
    volSlider.addEventListener('input', () => { m.volume = +volSlider.value; FS.save(); });
    const subVolSlider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': 'Subdivision volume' });
    subVolSlider.addEventListener('input', () => { m.subVolume = +subVolSlider.value; FS.save(); });

    // Trainer
    const trainerSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Trainer mode' });
    for (const [id, label] of [['off', 'Off'], ['step', 'Step'], ['ramp', 'Gradual']]) {
      trainerSeg.append(h('button', { dataset: { v: id }, onclick: () => { m.trainer.mode = id; FS.save(); restartIfRunning(); renderAll(); } }, label));
    }
    const numField = (label, key, min, max, suffix) => {
      const inp = h('input', { type: 'number', min, max, inputmode: 'numeric', 'aria-label': label });
      inp.addEventListener('change', () => {
        let v = parseInt(inp.value, 10);
        if (isNaN(v)) v = m.trainer[key];
        v = Math.min(max, Math.max(min, v));
        m.trainer[key] = v;
        inp.value = v;
        FS.save();
        renderAll();
      });
      const f = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'inline' }, inp, suffix ? h('span', { class: 'muted small' }, suffix) : null));
      f.input = inp;
      f.key = key;
      return f;
    };
    const tStart = numField('Start', 'start', MIN_BPM, MAX_BPM, 'BPM');
    const tEnd = numField('End', 'end', MIN_BPM, MAX_BPM, 'BPM');
    const tStep = numField('Change by', 'step', 1, 50, 'BPM');
    const tEvery = numField('Every', 'every', 1, 64, 'bars');
    const tRamp = numField('Over', 'rampBars', 1, 512, 'bars');
    const trainerFields = [tStart, tEnd, tStep, tEvery, tRamp];
    const progress = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
    const trainerStatus = h('div', { class: 'muted small trainer-status' });

    // Gap
    const gapToggle = h('input', { type: 'checkbox', role: 'switch' });
    gapToggle.addEventListener('change', () => { m.gap.on = gapToggle.checked; FS.save(); renderAll(); });
    const gapNum = (label, key) => {
      const inp = h('input', { type: 'number', min: key === 'play' ? 1 : 0, max: 32, inputmode: 'numeric', 'aria-label': label });
      inp.addEventListener('change', () => {
        let v = parseInt(inp.value, 10);
        if (isNaN(v)) v = m.gap[key];
        m.gap[key] = Math.min(32, Math.max(key === 'play' ? 1 : 0, v));
        inp.value = m.gap[key];
        FS.save();
      });
      const f = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'inline' }, inp, h('span', { class: 'muted small' }, 'bars')));
      f.input = inp;
      return f;
    };
    const gapPlay = gapNum('Play', 'play');
    const gapMute = gapNum('Then mute', 'mute');

    const field = (label, ...ctl) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), ...ctl);

    panel.append(
      h('div', { class: 'met-layout' },
        h('div', { class: 'card met-main' },
          h('div', { class: 'tempo-display' }, bpmNum, h('div', { class: 'bpm-unit' }, 'BPM'), bpmMark),
          sweep,
          dots,
          h('p', { class: 'hint center' }, 'Tap a beat to cycle accent · normal · soft · mute'),
          h('div', { class: 'tempo-row' }, stepBtn('−5', -5), stepBtn('−1', -1), slider, stepBtn('+1', 1), stepBtn('+5', 5)),
          h('div', { class: 'tempo-row' }, bpmInput, tapBtn, startBtn),
          status,
          h('p', { class: 'hint center kbd-hint' }, 'Space start/stop · ↑/↓ tempo (Shift ×5) · T tap')
        ),
        h('div', { class: 'met-side' },
          h('div', { class: 'card' },
            h('h3', { class: 'section-title' }, 'Meter'),
            h('div', { class: 'inline wrap gap-lg' },
              field('Beats per bar', h('span', { class: 'inline' }, beatsStepper, h('span', { class: 'slash' }, '/'), noteSel)),
              groupField,
              h('button', { class: 'btn ghost small', onclick: () => applyDefaultAccents() }, 'Reset accents')
            ),
            h('h3', { class: 'section-title' }, 'Subdivision'),
            subPills
          ),
          h('div', { class: 'card' },
            h('h3', { class: 'section-title' }, 'Sound'),
            soundSeg,
            h('div', { class: 'inline wrap gap-lg' }, field('Volume', volSlider), field('Subdivision volume', subVolSlider))
          ),
          h('div', { class: 'card' },
            h('h3', { class: 'section-title' }, 'Tempo trainer'),
            trainerSeg,
            h('div', { class: 'inline wrap gap-lg trainer-fields' }, ...trainerFields),
            progress,
            trainerStatus
          ),
          h('div', { class: 'card' },
            h('div', { class: 'section-head' },
              h('h3', { class: 'section-title' }, 'Gap trainer'),
              h('label', { class: 'switch' }, gapToggle, h('span', { class: 'slider' }))
            ),
            h('p', { class: 'muted small' }, 'Mute the click for a few bars to test your internal time.'),
            h('div', { class: 'inline wrap gap-lg' }, gapPlay, gapMute)
          )
        )
      )
    );

    slider.addEventListener('input', () => setBpm(+slider.value));
    bpmInput.addEventListener('change', () => {
      const v = parseInt(bpmInput.value, 10);
      setBpm(isNaN(v) ? m.bpm : v);
    });

    /* ---- Actions ---- */

    function setBpm(v) {
      m.bpm = clampBpm(Math.round(v));
      if (!trainerOn()) eng.liveBpm = m.bpm;
      FS.save();
      renderTempo();
    }

    function setBeats(n) {
      n = Math.min(16, Math.max(1, n));
      if (n === m.beats) return;
      m.beats = n;
      applyDefaultAccents();
    }

    function applyDefaultAccents() {
      m.grouping = defaultGrouping(m.beats, m.noteValue);
      m.levels = levelsFromGrouping(m.beats, m.grouping);
      FS.save();
      renderAll();
    }

    function cycleLevel(i) {
      fixLevels();
      m.levels[i] = (m.levels[i] + 3) % 4; // 3 → 2 → 1 → 0 → 3
      FS.save();
      renderDots();
    }

    let taps = [];
    function tap() {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      if (taps.length > 8) taps.shift();
      tapBtn.classList.remove('flash');
      void tapBtn.offsetWidth;
      tapBtn.classList.add('flash');
      if (taps.length >= 2) {
        const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
        setBpm(60000 / avg);
      }
    }

    function restartIfRunning() {
      if (eng.running) {
        stop();
        start();
      }
    }

    function preview() {
      FS.audio.loadSamples().then(() => {
        const ctx = FS.audio.ctx();
        FS.audio.playSample(SOUND_SETS[m.sound].accent, ctx.currentTime + 0.02, m.volume);
      });
    }

    /* ---- Rendering ---- */

    function renderTempo() {
      const shown = eng.running ? eng.liveBpm : trainerOn() ? m.trainer.start : m.bpm;
      bpmNum.textContent = Math.round(shown);
      bpmMark.textContent = tempoMarking(shown);
      slider.value = m.bpm;
      if (document.activeElement !== bpmInput) bpmInput.value = m.bpm;
      const locked = trainerOn();
      [slider, bpmInput].forEach((el) => (el.disabled = locked));
      slider.parentElement.classList.toggle('locked', locked);
    }

    function renderDots() {
      fixLevels();
      if (dots.children.length !== m.beats) {
        dots.innerHTML = '';
        for (let i = 0; i < m.beats; i++) {
          dots.append(h('button', { class: 'beat-dot', dataset: { i }, onclick: () => cycleLevel(i) }, h('span', null, String(i + 1))));
        }
      }
      [...dots.children].forEach((d, i) => {
        d.dataset.level = m.levels[i];
        d.setAttribute('aria-label', `Beat ${i + 1}: ${LEVEL_NAMES[m.levels[i]]}`);
      });
    }

    function renderRunning() {
      startBtn.innerHTML = eng.running ? '■ Stop' : '▶ Start';
      startBtn.classList.toggle('running', eng.running);
      renderTempo();
      renderStatus();
    }

    function renderStatus() {
      if (!eng.running || !eng.current) {
        status.textContent = eng.running ? 'Starting…' : 'Stopped';
        return;
      }
      const c = eng.current;
      const ctx = FS.audio.ctx();
      const el = Math.max(0, ctx.currentTime - eng.startTime);
      const mm = Math.floor(el / 60);
      const ss = String(Math.floor(el % 60)).padStart(2, '0');
      status.textContent = `Bar ${c.bar + 1} · Beat ${c.beat + 1} · ${mm}:${ss}${c.silent ? ' · (muted)' : ''}`;
    }

    function renderTrainer() {
      const tr = m.trainer;
      trainerSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === tr.mode));
      trainerFields.forEach((f) => {
        f.input.value = tr[f.key];
        const show = tr.mode !== 'off' && (f === tStep || f === tEvery ? tr.mode === 'step' : f === tRamp ? tr.mode === 'ramp' : true);
        f.hidden = !show;
      });
      progress.hidden = tr.mode === 'off';
      trainerStatus.hidden = tr.mode === 'off';
      updateTrainerProgress();
    }

    function updateTrainerProgress() {
      const tr = m.trainer;
      if (tr.mode === 'off') return;
      const cur = eng.running ? eng.liveBpm : tr.start;
      const span = tr.end - tr.start;
      const p = span === 0 ? 1 : Math.min(1, Math.max(0, (cur - tr.start) / span));
      progress.firstChild.style.width = `${p * 100}%`;
      const dir = '→';
      if (tr.mode === 'step') {
        trainerStatus.textContent = eng.running
          ? `${Math.round(cur)} BPM ${dir} ${tr.end} · ${p >= 1 ? 'target reached' : `next change in ${Math.max(1, tr.every) - eng.barsSinceStep} bar(s)`}`
          : `${tr.start} ${dir} ${tr.end} BPM, ${span >= 0 ? '+' : '−'}${tr.step} every ${tr.every} bar(s)`;
      } else {
        trainerStatus.textContent = eng.running
          ? `${cur.toFixed(1)} BPM ${dir} ${tr.end} · ${Math.round(p * 100)}%`
          : `${tr.start} ${dir} ${tr.end} BPM smoothly over ${tr.rampBars} bars`;
      }
    }

    function renderAll() {
      fixLevels();
      beatsVal.textContent = m.beats;
      noteSel.value = m.noteValue;
      groupField.hidden = m.noteValue < 8;
      groupInput.value = m.grouping;
      subPills.querySelectorAll('.pill').forEach((b) => b.classList.toggle('active', b.dataset.v === m.subdivision));
      soundSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === m.sound));
      volSlider.value = m.volume;
      subVolSlider.value = m.subVolume;
      gapToggle.checked = m.gap.on;
      gapPlay.input.value = m.gap.play;
      gapMute.input.value = m.gap.mute;
      [gapPlay, gapMute].forEach((f) => f.classList.toggle('disabled', !m.gap.on));
      renderDots();
      renderTrainer();
      renderRunning();
    }

    function resetVisuals() {
      [...dots.children].forEach((d) => d.classList.remove('on'));
      sweep.firstChild.style.transform = 'translateX(0)';
      sweep.classList.remove('silent');
    }

    let lastStatus = 0;
    function draw() {
      if (!eng.running) return;
      const ctx = FS.audio.ctx();
      const now = audibleNow(ctx);
      let changed = false;
      while (eng.queue.length && eng.queue[0].time <= now) {
        eng.current = eng.queue.shift();
        changed = true;
      }
      const c = eng.current;
      if (c) {
        if (changed) {
          [...dots.children].forEach((d, i) => d.classList.toggle('on', i === c.beat));
          sweep.classList.toggle('silent', c.silent);
          bpmNum.textContent = Math.round(c.bpm);
          bpmMark.textContent = tempoMarking(c.bpm);
          const pulse = dots.children[c.beat];
          if (pulse) {
            pulse.classList.remove('hit');
            void pulse.offsetWidth;
            pulse.classList.add('hit');
          }
          updateTrainerProgress();
        }
        const phase = Math.min(1, Math.max(0, (now - c.time) / c.dur));
        const eased = (1 - Math.cos(Math.PI * phase)) / 2;
        const pos = c.n % 2 === 0 ? eased : 1 - eased;
        const w = sweep.clientWidth - sweep.firstChild.clientWidth;
        sweep.firstChild.style.transform = `translateX(${pos * w}px)`;
      }
      if (performance.now() - lastStatus > 200) {
        lastStatus = performance.now();
        renderStatus();
      }
      requestAnimationFrame(draw);
    }

    /* ---- Keyboard ---- */
    document.addEventListener('keydown', (e) => {
      if (FS.settings.tab !== 'metronome') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (tag === 'button' && (e.code === 'Space' || e.key === 'Enter')) return; // let the focused button handle it
      if (e.code === 'Space') {
        e.preventDefault();
        eng.running ? stop() : start();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        setBpm(m.bpm + (e.shiftKey ? 5 : 1));
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setBpm(m.bpm - (e.shiftKey ? 5 : 1));
      } else if (e.key === 't' || e.key === 'T') {
        tap();
      }
    });

    renderAll();
    FS.metronome = { start, stop, engine: eng };
  };

  // Exposed for tests.
  FS.metronomeHelpers = { defaultGrouping, levelsFromGrouping, parseGrouping, tempoMarking };
})();
